import { readCodeReviewProcessRecord } from "file:///C:/code/node_modules/@spencer-shadley/cli-wrappers/dist/lib/fence/review/review-process-producer.js";
const result = readCodeReviewProcessRecord("job-1791880279903-hiow4m");
if (result.kind !== "found") console.log(JSON.stringify(result));
else {
  const { host, state, seat } = result.record;
  console.log(JSON.stringify({ host, model: state.model, executor: state.executor,
    subscriptionId: state.subscriptionId, status: state.status, exitCode: state.exitCode,
    effort: seat.seat?.effort,
    selected: seat.selected ? { model: seat.selected.model, effort: seat.selected.effort, executor: seat.selected.executor } : undefined,
    binding: seat.binding ? { model: seat.binding.model, effort: seat.binding.effort, executor: seat.binding.executor } : undefined,
    createdAt: state.createdAt, completedAt: state.completedAt,
    invocation: state.firstOutputFact?.fact?.identity?.invocationId }));
}
