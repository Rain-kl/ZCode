# Bundled collaboration guidance

The six-tool-only decision also applies to instructions loaded from bundled
skills. Removing executable tool entries while leaving Agent/Task examples in
those skills would teach the model to call unavailable tools.

The ZCode-hosted Superpowers instructions and review templates must dispatch
with spawn_agent, wait for activity with wait_agent, observe messages at the
normal safe boundary, and use followup_task to continue an existing agent.
send_message alone does not start idle work. interrupt_agent stops a selected
run without deleting its identity; completion releases execution capacity
automatically. There is no close_agent action.

Fresh context guidance uses fork_turns none, with a separate stable task_name
and a full message. Parallel examples must respect the available concurrency
and shared working directory. Preserve the implementation/review ordering and
user authorization rules of each skill.

The dynamic-workflows skill continues to describe CreateWorkflow and its own
typed script API. Its routing guidance for ordinary delegation must point to
spawn_agent; the workflow script's agent() API is unrelated and remains intact.

Foreign-platform mapping references can describe those platforms' native tools;
they must not provide a ZCode compatibility fallback. ZCode has an explicit
mapping loaded from using-superpowers, independent of those references.

Regression contracts load the actual shipped Markdown, reject old executable
dispatch syntax in active templates and examples, verify the six ZCode actions
and their idle-send/continuation distinction, and preserve workflow routing.
