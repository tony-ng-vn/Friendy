/** CLI entry for `npm run eval:agent`; prints summary and sets exit code from required failures. */
import { formatEvalSummary, getEvalExitCode, runRelationshipAgentEvals, shouldRunModelBackedEvals } from "./agentEvalRunner";

const summary = await runRelationshipAgentEvals({
  runModelBackedEvals: shouldRunModelBackedEvals(process.env)
});

console.log(formatEvalSummary(summary));
process.exitCode = getEvalExitCode(summary);
