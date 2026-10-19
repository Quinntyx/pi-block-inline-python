import test from "node:test";
import assert from "node:assert/strict";
import extension from "../extensions/block-inline-python.ts";

type ToolCallResult = { block?: boolean; reason?: string } | undefined;
type Handler = (event: unknown) => Promise<ToolCallResult>;

/** Fresh extension instance => fresh first-attempt state for each test. */
function load() {
	let handler: Handler | undefined;
	extension({
		on(event: string, h: Handler) {
			if (event === "tool_call") handler = h;
			return () => {};
		},
	} as never);
	assert.ok(handler, "extension registered a tool_call handler");
	return (command: string, toolName = "bash"): Promise<ToolCallResult> =>
		handler!({ type: "tool_call", toolCallId: "call-1", toolName, input: { command } });
}

const blocked = (r: ToolCallResult) => r?.block === true;
const allowed = (r: ToolCallResult) => r === undefined;

test("blocks stdin heredoc invocations", async () => {
	const call = load();
	for (const command of [
		"python3 << 'EOF'\nprint(1)\nEOF",
		'python << "PY"\nprint(1)\nPY',
		"python3 <<EOF\nprint(1)\nEOF",
		"python3 - <<'EOF'\nprint(1)\nEOF",
		"python3 -u << 'EOF'\nprint(1)\nEOF",
		"/usr/bin/python3 << 'EOF'\nprint(1)\nEOF",
		"python3.12 << 'EOF'\nprint(1)\nEOF",
		"pypy3 << 'PY'\nprint(1)\nPY",
		"cd /tmp && python3 << 'EOF'\nprint(1)\nEOF",
	]) {
		assert.ok(blocked(await call(command)), `should block: ${JSON.stringify(command)}`);
	}
});

test("blocks inline -c invocations", async () => {
	const call = load();
	for (const command of [
		"python3 -c 'print(1)'",
		'python -c "print(1)"',
		"python3 -uc 'import sys; print(sys.version)'",
		"python3 -Bc 'print(1)'",
		"python3 -W ignore -c 'print(1)'",
		"python3.11 -c 'print(1)'",
		"/usr/bin/python3 -c 'print(1)'",
		"true && python3 -c 'print(1)'",
	]) {
		assert.ok(blocked(await call(command)), `should block: ${JSON.stringify(command)}`);
	}
});

test("leaves ordinary python invocations alone", async () => {
	const call = load();
	for (const command of [
		"python3 script.py",
		"python3 -m pytest -q",
		"python3 -m http.server 8000",
		"python3 --version",
		"node -e 'console.log(1)'",
		"rg 'python3 -m pytest' docs/",
	]) {
		assert.ok(allowed(await call(command)), `should allow: ${JSON.stringify(command)}`);
	}
});

test("allows the exact same call once, then blocks again", async () => {
	const call = load();
	const command = "python3 << 'EOF'\nprint(1)\nEOF";

	assert.ok(blocked(await call(command)), "first attempt blocked");
	assert.ok(allowed(await call(command)), "identical rerun allowed");
	assert.ok(blocked(await call(command)), "third identical call blocked again");
});

test("a different inline command is still blocked after an allowed rerun", async () => {
	const call = load();
	assert.ok(blocked(await call("python3 -c 'print(1)'")));
	assert.ok(allowed(await call("python3 -c 'print(1)'")));
	assert.ok(blocked(await call("python3 -c 'print(2)'")));
});

test("reason points at the kernel escape hatch", async () => {
	const call = load();
	const result = await call("python3 -c 'print(1)'");
	assert.ok(blocked(result));
	assert.match(result!.reason!, /provision_kernel/);
	assert.match(result!.reason!, /exec_cell/);
	assert.match(result!.reason!, /rerun this exact same tool call/);
});

test("ignores non-shell tools", async () => {
	const call = load();
	assert.ok(allowed(await call("python3 -c 'print(1)'", "read")));
	// and does not consume the first-attempt warning for bash
	assert.ok(blocked(await call("python3 -c 'print(1)'", "bash")));
});
