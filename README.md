# pi-block-inline-python

Resist inline Python execution in Pi. On the first attempt, `python3` heredocs and
`python3 -c` calls are blocked with a warning that points at the Python kernel
(`provision_kernel` + `exec_cell` / notebook cells).

Blocked on first attempt:

```bash
python3 << 'EOF'
print("hello")
EOF

python3 -c 'print("hello")'
python3 -uc 'import sys; print(sys.version)'
```

Not blocked: `python3 script.py`, `python3 -m module`, and every non-shell tool.

## Escape hatch

If the invocation is legitimate and genuinely cannot be expressed as a notebook cell,
rerun the **exact same tool call** (identical command). The second identical call is
allowed once; a third identical call is blocked again. The first-attempt record is
in-memory, per extension load, and expires after one hour.

## Install

```json
"git:git.quinntyx.dev/quinntyx/pi-block-inline-python"
```

## Test

```bash
npm install
npm test
npm run check
```
