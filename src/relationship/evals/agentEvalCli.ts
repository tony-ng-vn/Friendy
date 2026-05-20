import { formatEvalSummary, getEvalExitCode, runRelationshipAgentEvals, shouldRunModelBackedEvals } from "./agentEvalRunner";

const summary = await runRelationshipAgentEvals({
  runModelBackedEvals: shouldRunModelBackedEvals(process.env)
});

console.log(formatEvalSummary(summary));
process.exitCode = getEvalExitCode(summary);
