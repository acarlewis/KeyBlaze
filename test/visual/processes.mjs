// OS-level CPU and memory of one isolated VS Code instance (Windows, Win32_Process via PowerShell).
// Test tooling only.
import { execFileSync } from 'node:child_process';

const QUERY =
  'Get-CimInstance Win32_Process -Filter "Name=\'Code.exe\'" | ' +
  'Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,PrivatePageCount,WorkingSetSize,CommandLine | ' +
  'ConvertTo-Json -Compress';

function kindOf(p, extensionHostPid) {
  if (p.ProcessId === extensionHostPid) return 'extensionHost';
  const cmd = p.CommandLine ?? '';
  const type = /--type=([\w-]+)/.exec(cmd)?.[1];
  if (!type) return 'main';
  if (type === 'renderer') return 'renderer';
  if (type === 'gpu-process') return 'gpu';
  return 'other';
}

/** Every process in the tree under `rootPid`, with cumulative CPU (ms) and private memory (MB). */
export function processSnapshot(rootPid, extensionHostPid) {
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', QUERY], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const all = [].concat(JSON.parse(out));
  const children = new Map();
  for (const p of all) {
    if (!children.has(p.ParentProcessId)) children.set(p.ParentProcessId, []);
    children.get(p.ParentProcessId).push(p);
  }
  const tree = [];
  const stack = all.filter((p) => p.ProcessId === rootPid);
  while (stack.length) {
    const p = stack.pop();
    tree.push({
      pid: p.ProcessId,
      kind: kindOf(p, extensionHostPid),
      cpuMs: (Number(p.KernelModeTime) + Number(p.UserModeTime)) / 10_000,
      privateMB: Number(p.PrivatePageCount) / 1048576,
    });
    stack.push(...(children.get(p.ProcessId) ?? []));
  }
  return { at: Date.now(), processes: tree };
}

/** CPU used between two snapshots, in % of one core, per process kind and in total. */
export function cpuDelta(a, b, seconds) {
  const before = new Map(a.processes.map((p) => [p.pid, p.cpuMs]));
  const byKind = {};
  let total = 0;
  for (const p of b.processes) {
    const used = p.cpuMs - (before.get(p.pid) ?? 0);
    byKind[p.kind] = (byKind[p.kind] ?? 0) + used;
    total += used;
  }
  const pct = (ms) => +((ms / 1000 / seconds) * 100).toFixed(1);
  return {
    cpuPct: pct(total),
    renderer: pct(byKind.renderer ?? 0),
    gpu: pct(byKind.gpu ?? 0),
    extensionHost: pct(byKind.extensionHost ?? 0),
    main: pct(byKind.main ?? 0),
    other: pct(byKind.other ?? 0),
  };
}

/** Private memory (MB) per process kind. */
export function memoryByKind(snapshot) {
  const byKind = {};
  for (const p of snapshot.processes)
    byKind[p.kind] = +((byKind[p.kind] ?? 0) + p.privateMB).toFixed(1);
  return byKind;
}
