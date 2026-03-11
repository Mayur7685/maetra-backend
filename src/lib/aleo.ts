import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const NETWORK = "testnet";
const ENDPOINT = "https://api.explorer.provable.com/v1";

const PROGRAMS = {
  TRUST: "maetra_trust.aleo",
  SUBSCRIPTION: "maetra_subscription_v3.aleo",
  CONTENT: "maetra_content.aleo",
} as const;

interface AleoTxResult {
  transactionId: string;
}

async function execute(
  program: string,
  fn: string,
  inputs: string[],
  fee: number = 500_000,
): Promise<AleoTxResult> {
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not configured");
  }

  const args = [
    "developer", "execute",
    "--private-key", PRIVATE_KEY,
    "--query", ENDPOINT,
    "--broadcast", `${ENDPOINT}/${NETWORK}/transaction/broadcast`,
    "--network", "1", // testnet = 1
    "--priority-fee", fee.toString(),
    program,
    fn,
    ...inputs,
  ];

  console.log("[Aleo Execute]", { program, function: fn, inputs });

  try {
    const { stdout, stderr } = await execFileAsync("snarkos", args, {
      timeout: 300_000, // 5 min for proving
    });

    console.log("[Aleo Execute] stdout:", stdout);
    if (stderr) console.log("[Aleo Execute] stderr:", stderr);

    // Extract transaction ID from output (format: at1...)
    const txMatch = stdout.match(/(at1[a-z0-9]{58,62})/);
    if (txMatch) {
      return { transactionId: txMatch[1] };
    }

    // Try to find it in a different format
    const altMatch = stdout.match(/transaction[:\s]+"?(at1[a-z0-9]+)"?/i);
    if (altMatch) {
      return { transactionId: altMatch[1] };
    }

    throw new Error("Could not extract transaction ID from output: " + stdout.slice(0, 200));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Aleo Execute] Failed:", msg);
    throw new Error("Aleo execution failed: " + msg);
  }
}

export const aleo = {
  setPrice: (priceMicrocredits: number) =>
    execute(PROGRAMS.SUBSCRIPTION, "set_price", [`${priceMicrocredits}u64`]),

  publishContent: (postId: string, contentHash: string) =>
    execute(PROGRAMS.CONTENT, "publish", [postId, contentHash]),

  submitPerformance: (inputs: {
    profitable_days: string;
    total_days: string;
    trade_count: string;
    current_streak: string;
    avg_volume_usd: string;
  }) =>
    execute(PROGRAMS.TRUST, "submit_performance", [
      inputs.profitable_days,
      inputs.total_days,
      inputs.trade_count,
      inputs.current_streak,
      inputs.avg_volume_usd,
    ]),

  subscribe: (creatorAddress: string, amount: number, duration: number = 430_000) =>
    execute(PROGRAMS.SUBSCRIPTION, "subscribe", [
      creatorAddress,
      `${amount}u64`,
      `${duration}u64`,
    ]),
};
