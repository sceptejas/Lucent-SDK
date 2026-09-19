import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type SolanaRpcApi,
  type TransactionSigner,
  type Rpc,
} from '@solana/kit'
import {
  MAX_COMPUTE_UNIT_LIMIT,
  estimateComputeUnitLimitFactory,
  setTransactionMessageComputeUnitPrice,
  updateOrAppendSetComputeUnitLimitInstruction,
} from '@solana-program/compute-budget'

declare const signer: TransactionSigner
declare const rpc: Rpc<SolanaRpcApi>
declare const instructions: Instruction[]

export async function scratch() {
  const { value: latest } = await rpc.getLatestBlockhash().send()

  // One pipe: kit brands the message type at each step, so reassigning a variable
  // to a differently-shaped message does not typecheck.
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(signer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    m => setTransactionMessageComputeUnitPrice(1_000, m),
    m => appendTransactionMessageInstructions(instructions, m),
    m => updateOrAppendSetComputeUnitLimitInstruction(MAX_COMPUTE_UNIT_LIMIT, m),
  )

  // Estimation takes the message, before signing.
  const estimated = await estimateComputeUnitLimitFactory({ rpc })(message)
  const sized = updateOrAppendSetComputeUnitLimitInstruction(estimated ?? 200_000, message)

  const signed = await signTransactionMessageWithSigners(sized)
  const wire = getBase64EncodedWireTransaction(signed)
  const signature = getSignatureFromTransaction(signed)
  const simulation = await rpc
    .simulateTransaction(wire, { sigVerify: false, replaceRecentBlockhash: true, encoding: 'base64' })
    .send()

  return { wire, signature, simulation, estimated }
}
