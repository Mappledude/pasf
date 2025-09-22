type DebugEntry = { ts: number; tag: string; msg: string; data?: any };

const TAGS = new Set(["[PRESENCE]", "[WRITER]", "[ARENA]", "[STATE]", "[INPUT]", "[HIT]"]);
const buffer: DebugEntry[] = [];
const MAX = 2000;

type Sub = (entries: DebugEntry[]) => void;
const subs = new Set<Sub>();

export const debugPush = (tag: string, msg: string, data?: any) => {
  if (!TAGS.has(tag)) return;
  const entry: DebugEntry = { ts: Date.now(), tag, msg, data };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  subs.forEach((fn) => fn(buffer));
};

export const debugGet = () => buffer.slice();

export const debugSubscribe = (fn: Sub) => {
  subs.add(fn);
  fn(buffer);
  return () => {
    subs.delete(fn);
  };
};

export const debugClear = () => {
  buffer.length = 0;
  subs.forEach((fn) => fn(buffer));
};

export const debugExportText = () => {
  const lines = buffer.map((e) => {
    const t = new Date(e.ts).toISOString();
    const payload = e.data !== undefined ? " " + JSON.stringify(e.data) : "";
    return `${t} ${e.tag} ${e.msg}${payload}`;
  });
  return lines.join("\n");
};

export const installConsoleMirror = () => {
  const origLog = console.log.bind(console);
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug.bind(console);

  const mirror = (args: any[]) => {
    if (typeof args[0] === "string") {
      const first = args[0];
      const tag = first.split(" ")[0];
      if (TAGS.has(tag)) {
        const msg = args
          .map((a) => {
            if (typeof a === "string") return a;
            if (typeof a === "number" || typeof a === "boolean") return String(a);
            return "";
          })
          .join(" ")
          .trim();
        const data = args.find((a) => typeof a === "object" && a !== null);
        debugPush(tag, msg.replace(tag, "").trim(), data);
      }
    }
  };

  console.log = (...args: any[]) => {
    mirror(args);
    origLog(...args);
  };
  console.info = (...args: any[]) => {
    mirror(args);
    origInfo(...args);
  };
  console.warn = (...args: any[]) => {
    mirror(args);
    origWarn(...args);
  };
  console.error = (...args: any[]) => {
    mirror(args);
    origError(...args);
  };
  console.debug = (...args: any[]) => {
    mirror(args);
    origDebug(...args);
  };
};
