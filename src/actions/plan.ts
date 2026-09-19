/**
 * Transaction plans.
 *
 * An action never returns a sent transaction. It returns a plan: the
 * instructions it will submit, the fee it will pay, a `simulate()` that shows
 * what would happen, and a `send()` that does it. Three reasons, all of them
 * things v0 got wrong by going straight to `sendTransaction`:
 *
 *   1. **A wallet cannot show a user what they are approving** if the only door
 *      is "send". The plan is the thing a UI renders before the prompt.
 *   2. **Simulation is free, failure is not.** `send()` simulates first by
 *      default, so a transaction the program would reject costs a round trip
 *      rather than a fee and a confusing error.
 *   3. **Fees have to be decided somewhere.** They are on the plan, not hidden in
 *      a send call, so a caller can raise them or refuse.
 *
 * Simulating without a signature is the fiddly part. A wallet adapter signer
 * would raise a user prompt, which defeats the point, so simulation builds the
 * *whole transaction* against a placeholder signer that produces an all-zero
 * signature, and submits with `sigVerify: false`. Building it the same way as
 * the real transaction matters: kit refuses a message carrying two different
 * signer objects for one address, so the placeholder has to be used for the
 * instruction accounts too, not just the fee payer. The addresses are unchanged,
 * which is all the program sees.
 */
import {
  assertIsTransactionWithBlockhashLifetime,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isSolanaError,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Rpc,
  type RpcSubscriptions,
  type Signature,
  type SignatureBytes,
  type SignatureDictionary,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type TransactionPartialSigner,
  type TransactionSigner,
} from '@solana/kit'
import {
  MAX_COMPUTE_UNIT_LIMIT,
  estimateComputeUnitLimitFactory,
  setTransactionMessageComputeUnitPrice,
  updateOrAppendSetComputeUnitLimitInstruction,
} from '@solana-program/compute-budget'

export interface SimulationResult {
  /** False when the program rejected the transaction. */
  ok: boolean
  /** Compute units the simulation consumed, when the RPC reports it. */
  unitsConsumed: number | null
  /** Program logs, for surfacing a decoded reason. */
  logs: string[]
  /** The decoded error when the simulation failed. */
  error: string | null
}

export interface ActionPlanFee {
  computeUnitLimit: number
  microLamportsPerComputeUnit: number
  /** Worst-case transaction fee in lamports (priority + base), for display. */
  maxLamports: bigint
}

export interface ActionPlan {
  /** Machine name, e.g. `stake`. */
  action: string
  /** One line a UI can show before the wallet prompt. */
  summary: string
  /** The instructions, built for the configured signer. */
  instructions: readonly Instruction[]
  fee: ActionPlanFee
  /** Simulate against the live cluster. Free, and needs no signature. */
  simulate(): Promise<SimulationResult>
  /**
   * Sign, send and confirm.
   *
   * Simulates first unless `skipSimulation` is set: a transaction the program
   * will reject should not cost a fee to discover.
   */
  send(options?: { skipSimulation?: boolean }): Promise<{ signature: Signature }>
}

export interface PlanConfig {
  action: string
  summary: string
  /**
   * Build the instructions for a given signer.
   *
   * Called once per attempt, so it always reads fresh chain state — which is what
   * makes a redemption survive the nonce race: the claim-record PDA is seeded
   * with the pool's current nonce, and two unstakes in one slot collide.
   */
  build: (signer: TransactionSigner) => Promise<Instruction[]>
  signer: TransactionSigner
  rpc: Rpc<SolanaRpcApi>
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>
  /** Fee in microLamports per CU, already estimated. */
  microLamportsPerComputeUnit: number
  /** Fixed CU limit, or omit to estimate it by simulation. */
  computeUnitLimit?: number
}

/**
 * A signature dictionary maps an address to signature *bytes*, so the empty
 * signature is 64 zero bytes rather than the base58 string that a `Signature`
 * (the transaction id) is.
 */
const ZERO_SIGNATURE_BYTES = new Uint8Array(64) as SignatureBytes

/**
 * A signer that signs nothing.
 *
 * Used only for simulation. All-zero signatures are accepted because the request
 * sets `sigVerify: false`; the wire format still needs the slot to exist, since a
 * transaction whose signature count does not match its message header is
 * malformed rather than merely unsigned.
 */
function placeholderSigner(address: Address): TransactionPartialSigner {
  return {
    address,
    signTransactions: async transactions =>
      transactions.map((): SignatureDictionary => ({ [address]: ZERO_SIGNATURE_BYTES })),
  }
}

/** Rough base fee of a single-signature transaction. */
const BASE_FEE_LAMPORTS = 5_000n

export async function createActionPlan(config: PlanConfig): Promise<ActionPlan> {
  const {
    action,
    summary,
    signer,
    rpc,
    rpcSubscriptions,
    microLamportsPerComputeUnit,
  } = config

  const estimateUnits = estimateComputeUnitLimitFactory({ rpc })

  // Built once up front so a UI can inspect the instructions before it decides to
  // simulate or send. Rebuilt on every send attempt.
  let built: readonly Instruction[] = await config.build(signer)

  let fee: ActionPlanFee = {
    computeUnitLimit: config.computeUnitLimit ?? MAX_COMPUTE_UNIT_LIMIT,
    microLamportsPerComputeUnit,
    maxLamports:
      (BigInt(config.computeUnitLimit ?? MAX_COMPUTE_UNIT_LIMIT) * BigInt(microLamportsPerComputeUnit)) /
        1_000_000n +
      BASE_FEE_LAMPORTS,
  }

  const withFee = (computeUnitLimit: number): ActionPlanFee => ({
    computeUnitLimit,
    microLamportsPerComputeUnit,
    maxLamports:
      (BigInt(computeUnitLimit) * BigInt(microLamportsPerComputeUnit)) / 1_000_000n + BASE_FEE_LAMPORTS,
  })

  async function compile(useSigner: TransactionSigner, instructions: Instruction[]) {
    const { value: latest } = await rpc.getLatestBlockhash().send()

    // One pipe: kit brands the message type at each step, so reassigning a
    // variable to a differently shaped message does not typecheck.
    return pipe(
      createTransactionMessage({ version: 0 }),
      m => setTransactionMessageFeePayerSigner(useSigner, m),
      m => setTransactionMessageLifetimeUsingBlockhash(latest, m),
      m => setTransactionMessageComputeUnitPrice(microLamportsPerComputeUnit, m),
      m => appendTransactionMessageInstructions(instructions, m),
      m => updateOrAppendSetComputeUnitLimitInstruction(fee.computeUnitLimit, m),
    )
  }

  const simulate = async (): Promise<SimulationResult> => {
    try {
      const simulationSigner = placeholderSigner(signer.address)
      const instructions = await config.build(simulationSigner)
      const message = await compile(simulationSigner, instructions)

      // Resolve the CU limit from the simulation when the caller did not fix one.
      if (config.computeUnitLimit === undefined) {
        const estimated = await estimateUnits(message).catch(() => null)
        if (estimated !== null && estimated > 0) fee = withFee(estimated)
      }

      const sized = updateOrAppendSetComputeUnitLimitInstruction(fee.computeUnitLimit, message)
      const signed = await signTransactionMessageWithSigners(sized)
      const wire = getBase64EncodedWireTransaction(signed)

      const { value } = await rpc
        .simulateTransaction(wire, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          encoding: 'base64',
          commitment: 'confirmed',
        })
        .send()

      const logs = value.logs ?? []
      const unitsConsumed = typeof value.unitsConsumed === 'number' ? value.unitsConsumed : null

      if (value.err) {
        return { ok: false, unitsConsumed, logs, error: describeProgramError(value.err, logs) }
      }
      return { ok: true, unitsConsumed, logs, error: null }
    } catch (cause) {
      // A simulation that could not run at all is reported rather than thrown, so
      // `send()` can decide what to do with it.
      return {
        ok: false,
        unitsConsumed: null,
        logs: [],
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }

  return {
    action,
    summary,
    get instructions() {
      return built
    },
    get fee() {
      return fee
    },
    simulate,
    send: async (options = {}) => {
      if (!options.skipSimulation) {
        const result = await simulate()
        if (!result.ok) throw new ActionFailedError(action, result)
      }

      const attempt = async () => {
        const instructions = await config.build(signer)
        built = instructions
        const message = await compile(signer, instructions)
        const sized = updateOrAppendSetComputeUnitLimitInstruction(fee.computeUnitLimit, message)
        const signed = await signTransactionMessageWithSigners(sized)
        // The message was built with a blockhash lifetime; this asserts what the
        // type union cannot express.
        assertIsTransactionWithBlockhashLifetime(signed)
        const signature = getSignatureFromTransaction(signed)
        await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
          commitment: 'confirmed',
        })
        return { signature }
      }

      try {
        return await attempt()
      } catch (error) {
        // One retry, and only for the chain having moved under us.
        if (!isStaleBuild(error)) throw error
        return await attempt()
      }
    },
  }

}

/** A simulation the program rejected, with its logs preserved for the caller. */
export class ActionFailedError extends Error {
  readonly action: string
  readonly simulation: SimulationResult
  constructor(action: string, simulation: SimulationResult) {
    super(
      `${action} would fail: ${simulation.error ?? 'the program rejected the transaction'}. ` +
        'Pass { skipSimulation: true } to send it anyway.',
    )
    this.name = 'ActionFailedError'
    this.action = action
    this.simulation = simulation
  }
}

/** Errors that mean "the chain moved under you" and are worth one retry. */
function isStaleBuild(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
      : String(error)
  return /0x1781|NotNextInQueue|already in use|custom program error|nonce/i.test(text)
}

/**
 * Turn a program error into something a human can read.
 *
 * Anchor's own message is the useful part and it is in the logs, which beats the
 * raw instruction error: a number and a program id.
 */
export function describeProgramError(error: unknown, logs: string[]): string {
  const anchorMessage = [...logs]
    .reverse()
    .find(line => /Error Message:|AnchorError|Error Code:/i.test(line))
  if (anchorMessage) return anchorMessage.replace(/^Program log:\s*/, '').trim()

  if (isSolanaError(error)) return error.message

  if (typeof error === 'object' && error !== null) {
    const record = error as { InstructionError?: unknown }
    if (record.InstructionError) return JSON.stringify(record.InstructionError)
  }
  return typeof error === 'string' ? error : JSON.stringify(error)
}
