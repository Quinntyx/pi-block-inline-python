/**
 * block-inline-python.ts — Resist inline python execution.
 *
 * Blocks, on first attempt, bash/powershell calls that run Python code inline:
 *
 *   - stdin heredocs:   python3 << 'EOF' ... EOF
 *   - inline commands:  python3 -c 'print(1)'  (also -uc, -Bc, pypy3, ...)
 *
 * Blocking uses the `tool_call` event's `{ block: true, reason }` result. The
 * reason tells the model to use the Python kernel (`provision_kernel` +
 * `exec_cell`) so the code lands in a notebook instead of a shell heredoc.
 *
 * Escape hatch: if the *exact same* command is issued again, it is allowed
 * once and the first-attempt record is cleared. This keeps legitimate,
 * non-notebook uses possible without needing a configuration change.
 *
 * Intentionally NOT blocked:
 *   - `python3 script.py`        — ordinary file execution
 *   - `python3 -m module`        — module execution
 *   - `python3 - <<'EOF'`         — stdin script (blocked)
 *
 * This is an accident-guardrail, not a security boundary.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Optional path prefix plus any python/pypy interpreter spelling. */
const PYTHON = String.raw`(?:\S*\/)?(?:python|pypy)(?:\d+(?:\.\d+)*)?`;

/**
 * Leading interpreter flags. A flag may be bare (`-u`), a lone `-` (meaning
 * stdin), or one of the flags that take a separate argument (`-W ignore`).
 * Heredoc redirection may follow immediately.
 */
const FLAGS = String.raw`(?:(?:-[WXQ]\s+\S+|-|-[A-Za-z]+)\s+)*`;

/** `python3 << 'EOF'`, `python3 - <<EOF`, `pypy3 -u << "PY"`. */
const HEREDOC_RE = new RegExp(
	String.raw`(?:^|[\s;&|(){}[\]])${PYTHON}\s*${FLAGS}<<-?\s*["']?[A-Za-z_][A-Za-z0-9_]*["']?`,
);

/** `python3 -c '...'`, `python3 -uc "..."`, `python3 -W ignore -c ...`. */
const INLINE_C_RE = new RegExp(
	String.raw`(?:^|[\s;&|(){}[\]])${PYTHON}\s+${FLAGS}-[A-Za-z]*c[A-Za-z]*(?=\s|$|[^A-Za-z0-9_-])`,
);

const REASON =
	"Inline `python3` execution (`-c` and stdin heredocs such as `python3 << 'EOF'`) " +
	"is resisted by policy on first attempt: this looks like a shell heredoc or " +
	"`python3 -c` invocation, which bypasses the notebook and the shell-quoting rules. " +
	"Use the Python kernel instead: call `provision_kernel` (once per task) and run the " +
	"code in a notebook cell with `exec_cell` — the cell persists in the `.ipynb` and " +
	"results stay inspectable. If this specific invocation is legitimate and genuinely " +
	"cannot be expressed as a notebook cell, rerun this exact same tool call (identical " +
	"command) and it will be allowed once; a third identical call will be blocked again.";

const WARN_TTL_MS = 60 * 60 * 1000;

function isInlinePython(command: string): boolean {
	return HEREDOC_RE.test(command) || INLINE_C_RE.test(command);
}

function prune(warned: Map<string, number>, now: number): void {
	for (const [key, at] of warned) {
		if (now - at > WARN_TTL_MS) warned.delete(key);
	}
}

export default function (pi: ExtensionAPI) {
	/** Exact commands that already received the first-attempt warning (per extension load). */
	const warned = new Map<string, number>();

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
		const command = (event.input?.command as string | undefined) ?? "";
		if (!command || !isInlinePython(command)) return undefined;

		const now = Date.now();
		if (warned.has(command)) {
			warned.delete(command);
			return undefined;
		}

		prune(warned, now);
		warned.set(command, now);
		return { block: true, reason: REASON };
	});
}
