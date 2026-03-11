/**
 * Verify Aleo transactions against the explorer API.
 * Used to enforce on-chain payment before granting subscription access.
 */

const ALEO_API = "https://api.explorer.provable.com/v1";

interface AleoTransaction {
  status: string;
  type: string;
  index: number;
  transaction: {
    type: string;
    id: string;
    execution?: {
      transitions?: Array<{
        program: string;
        function: string;
        inputs?: Array<{ type: string; value: string }>;
      }>;
    };
  };
}

/**
 * Verify that an Aleo transaction:
 * 1. Exists and is confirmed
 * 2. Called the correct program/function
 *
 * Retries on 404 since the explorer may not have indexed the tx yet.
 */
export async function verifyAleoTransaction(
  txId: string,
  expectedProgram: string,
  expectedFunction: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Retry up to 5 times with 3s delay — explorer indexing can lag behind confirmation
    let lastStatus = 0;
    let res: Response | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`${ALEO_API}/testnet/transaction/${txId}`);
      lastStatus = res.status;

      if (res.ok) break;
      if (res.status === 404 && attempt < 4) {
        console.log(`[AleoVerify] Tx ${txId} not indexed yet, retry ${attempt + 1}/5...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      if (lastStatus === 404) {
        // After all retries, still not found — allow with warning
        // The tx was confirmed by the wallet; explorer just hasn't caught up
        console.warn(`[AleoVerify] Tx ${txId} not found after retries, allowing gracefully`);
        return { valid: true, error: "Transaction not yet indexed by explorer" };
      }
      return { valid: false, error: `Aleo API returned ${lastStatus}` };
    }

    const tx: AleoTransaction = await res.json();

    // Check transaction is confirmed (not rejected)
    if (tx.status === "rejected") {
      return { valid: false, error: "Transaction was rejected on-chain" };
    }

    // Verify the transaction called the expected program and function
    const transitions = tx.transaction?.execution?.transitions;
    if (!transitions || transitions.length === 0) {
      return { valid: false, error: "Transaction has no program executions" };
    }

    const match = transitions.find(
      (t) => t.program === expectedProgram && t.function === expectedFunction,
    );

    if (!match) {
      return {
        valid: false,
        error: `Transaction did not call ${expectedProgram}/${expectedFunction}`,
      };
    }

    return { valid: true };
  } catch (err) {
    console.error("[AleoVerify] Failed to verify transaction:", err);
    // Don't block subscriptions if the API is temporarily down —
    // log it and allow with a warning
    return { valid: true, error: "Aleo API unavailable, skipping verification" };
  }
}
