/** Provider 故障不能跳过后续隔离清理；保留原错误并顺序尝试全部资源。 */
export async function attemptAllCleanup(steps: readonly (() => Promise<unknown>)[]): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "CSC01 fixture cleanup failed");
}
