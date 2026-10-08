import type { LabEngine } from './lab';

export const supportedCommands = [
  'pwd',
  'ls',
  'cd',
  'cat',
  'echo',
  'grep',
  'head',
  'tail',
  'touch',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'find',
  'clear',
  'history',
  'date',
  'uptime',
  'whoami',
  'ps',
  'kill',
  'ip',
  'iw',
  'iwconfig',
  'bridge',
  'ping',
  'logread',
  'wpa_cli',
  'uci',
  'sync',
  'wifi',
  'reboot',
  'iperf3',
  'sleep',
  'test',
  'sh',
  'help',
];
export const windowsCommands = [
  'ipconfig',
  'dir',
  'cd',
  'cls',
  'ping',
  'tracert',
  'netstat',
  'netsh',
  'iperf3',
  'echo',
  'type',
  'help',
];

type Result = { out: string; err: string; code: number };
const ok = (out = ''): Result => ({ out, err: '', code: 0 });
const fail = (err: string): Result => ({ out: '', err, code: 1 });
type Node =
  | { kind: 'command'; words: string[]; guard?: '&&' | '||' }
  | { kind: 'while'; condition: Node[]; body: Node[] }
  | { kind: 'for'; variable: string; values: string[]; body: Node[] }
  | { kind: 'if'; condition: Node[]; yes: Node[]; no: Node[] };
export interface TerminalSnapshot {
  cwd: string;
  mode: 'shell' | 'wpa';
  history: string[];
  variables: Record<string, string>;
  files: Record<string, string>;
  directories: string[];
  listKeys: string[];
}

/** A deliberately bounded shell grammar. Parsing never evaluates JavaScript or host commands. */
function lex(source: string): string[] {
  const tokens: string[] = [];
  let word = '',
    quote = '',
    substitution = 0;
  const flush = () => {
    if (word) {
      tokens.push(word);
      word = '';
    }
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      next = source[i + 1];
    if (c === '\\' && quote !== "'") {
      word += c + (next ?? '');
      i++;
      continue;
    }
    if (quote) {
      word += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word += c;
      continue;
    }
    if (c === '$' && next === '(') {
      substitution++;
      word += '$(';
      i++;
      continue;
    }
    if (substitution) {
      word += c;
      if (c === '(') substitution++;
      if (c === ')') substitution--;
      continue;
    }
    if (c === '#' && !word) {
      while (i < source.length && source[i] !== '\n') i++;
      flush();
      tokens.push(';');
      continue;
    }
    if (c === '\n' || c === ';') {
      flush();
      tokens.push(';');
      continue;
    }
    if (/\s/.test(c)) {
      flush();
      continue;
    }
    if (c === '|' || c === '&' || c === '>') {
      if (c === '>' && word === '2') {
        word = '';
        tokens.push('2>');
        continue;
      }
      flush();
      if (next === c) {
        tokens.push(c + c);
        i++;
      } else tokens.push(c);
      continue;
    }
    if (c === '<' || c === '`') throw new Error(`unsupported shell syntax: ${c}`);
    word += c;
  }
  if (quote || substitution) throw new Error('syntax error: unclosed quote or substitution');
  flush();
  return tokens;
}

class Parser {
  private position = 0;
  constructor(private tokens: string[]) {}
  private consume(value: string) {
    while (this.tokens[this.position] === ';') this.position++;
    if (this.tokens[this.position++] !== value)
      throw new Error(`syntax error: expected '${value}'`);
  }
  parse(stops: string[] = []): Node[] {
    const nodes: Node[] = [];
    let guard: '&&' | '||' | undefined;
    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position];
      if (stops.includes(token)) break;
      if (token === ';') {
        this.position++;
        continue;
      }
      if (token === '&&' || token === '||') {
        guard = token;
        this.position++;
        continue;
      }
      if (token === 'while') {
        this.position++;
        const condition = this.parse(['do']);
        this.consume('do');
        const body = this.parse(['done']);
        this.consume('done');
        nodes.push({ kind: 'while', condition, body });
      } else if (token === 'if') {
        this.position++;
        const condition = this.parse(['then']);
        this.consume('then');
        const yes = this.parse(['else', 'fi']);
        let no: Node[] = [];
        if (this.tokens[this.position] === 'else') {
          this.position++;
          no = this.parse(['fi']);
        }
        this.consume('fi');
        nodes.push({ kind: 'if', condition, yes, no });
      } else if (token === 'for') {
        this.position++;
        const variable = this.tokens[this.position++];
        if (!variable || !/^[A-Za-z_]\w*$/.test(variable)) throw new Error('for: invalid variable');
        this.consume('in');
        const values: string[] = [];
        while (this.position < this.tokens.length && this.tokens[this.position] !== ';')
          values.push(this.tokens[this.position++]);
        this.consume('do');
        const body = this.parse(['done']);
        this.consume('done');
        nodes.push({ kind: 'for', variable, values, body });
      } else {
        if (['done', 'do', 'then', 'fi', 'else'].includes(token))
          throw new Error(`syntax error near '${token}'`);
        const words: string[] = [];
        while (
          this.position < this.tokens.length &&
          ![';', '&&', '||'].includes(this.tokens[this.position])
        )
          words.push(this.tokens[this.position++]);
        nodes.push({ kind: 'command', words, guard });
        guard = undefined;
      }
    }
    return nodes;
  }
}

/** Small integer expression parser; no eval/new Function and no access to host state. */
function arithmetic(expression: string, variables: Record<string, string>): number {
  const tokens = expression.match(/[A-Za-z_]\w*|\d+|[()+*/%-]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s+/g, ''))
    throw new Error('arithmetic: unsupported expression');
  let index = 0;
  const primary = (): number => {
    const token = tokens[index++];
    if (token === '-' || token === '+') return (token === '-' ? -1 : 1) * primary();
    if (token === '(') {
      const value = sum();
      if (tokens[index++] !== ')') throw new Error('arithmetic: unclosed parenthesis');
      return value;
    }
    if (!token) throw new Error('arithmetic: missing operand');
    const value = /^\d+$/.test(token) ? Number(token) : Number(variables[token] || 0);
    if (!Number.isFinite(value)) throw new Error('arithmetic: invalid number');
    return value;
  };
  const product = (): number => {
    let value = primary();
    while (['*', '/', '%'].includes(tokens[index])) {
      const op = tokens[index++],
        rhs = primary();
      if (rhs === 0 && op !== '*') throw new Error('arithmetic: division by zero');
      value = op === '*' ? value * rhs : op === '/' ? Math.trunc(value / rhs) : value % rhs;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (['+', '-'].includes(tokens[index])) {
      const op = tokens[index++],
        rhs = product();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  };
  const result = sum();
  if (index !== tokens.length || !Number.isSafeInteger(result))
    throw new Error('arithmetic: invalid expression');
  return result;
}

export class TerminalSession {
  cwd: string;
  mode: 'shell' | 'wpa' = 'shell';
  history: string[] = [];
  clearRequested = false;
  variables: Record<string, string> = { HOME: '/root', USER: 'root', '?': '0' };
  private files: Record<string, string> = {};
  private directories = new Set<string>();
  private listKeys = new Set<string>(['wireless.stamld0.device']);
  private operations = 0;
  private started = Date.now();
  private processes: Record<string, string> = {
    '1': '/sbin/procd',
    '84': '/sbin/netifd',
    '215': '/usr/sbin/wpa_supplicant -i stamld0',
  };
  constructor(
    public engine: LabEngine,
    public os: 'linux' | 'windows',
    snapshot?: TerminalSnapshot,
  ) {
    this.cwd = os === 'linux' ? '/root' : 'C:/QA';
    const dirs =
      os === 'linux'
        ? ['/', '/root', '/tmp', '/etc', '/etc/config', '/var', '/var/log', '/proc']
        : ['C:/', 'C:/QA', 'C:/QA/results'];
    dirs.forEach((dir) => this.directories.add(dir));
    this.files[this.resolve(os === 'linux' ? '/root/README.txt' : 'C:/QA/README.txt')] =
      'Wi-Fi QA Virtual Lab\nAll commands run in a simulated environment.\nUse help for supported commands.\n';
    if (snapshot) {
      this.cwd = snapshot.cwd;
      this.mode = snapshot.mode;
      this.history = [...snapshot.history];
      this.variables = { ...snapshot.variables };
      this.files = { ...snapshot.files };
      this.directories = new Set(snapshot.directories);
      this.listKeys = new Set(snapshot.listKeys);
    }
  }
  snapshot(): TerminalSnapshot {
    return {
      cwd: this.cwd,
      mode: this.mode,
      history: [...this.history],
      variables: { ...this.variables },
      files: { ...this.files },
      directories: [...this.directories],
      listKeys: [...this.listKeys],
    };
  }
  execute(source: string): string {
    this.clearRequested = false;
    this.operations = 0;
    if (!source.trim()) return '';
    this.history.push(source);
    if (this.history.length > 200) this.history.shift();
    if (this.os === 'windows') return this.windows(source);
    if (this.mode === 'wpa') return this.wpa(source.trim().split(/\s+/));
    try {
      const result = this.run(new Parser(lex(source.replace(/\r\n/g, '\n'))).parse());
      return [result.out, result.err].filter(Boolean).join('\n');
    } catch (error) {
      return `-ash: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  private run(nodes: Node[]): Result {
    const output: string[] = [],
      errors: string[] = [];
    let code = 0;
    for (const node of nodes) {
      if (++this.operations > 3000) throw new Error('execution limit exceeded (3000 operations)');
      let result: Result;
      if (node.kind === 'command') {
        if ((node.guard === '&&' && code !== 0) || (node.guard === '||' && code === 0)) continue;
        result = this.pipeline(node.words);
      } else if (node.kind === 'if') {
        const condition = this.run(node.condition);
        if (condition.err) errors.push(condition.err);
        result = this.run(condition.code === 0 ? node.yes : node.no);
      } else if (node.kind === 'for') {
        const values = node.values.map((value) => this.expand(value));
        if (values.length > 100) throw new Error('for: maximum 100 iterations');
        const results: Result[] = [];
        for (const value of values) {
          this.variables[node.variable] = value;
          results.push(this.run(node.body));
        }
        result = {
          out: results
            .map((r) => r.out)
            .filter(Boolean)
            .join('\n'),
          err: results
            .map((r) => r.err)
            .filter(Boolean)
            .join('\n'),
          code: results.at(-1)?.code ?? 0,
        };
      } else {
        let count = 0;
        const results: Result[] = [];
        while (this.run(node.condition).code === 0) {
          if (++count > 100) throw new Error('while: maximum 100 iterations; loop stopped');
          results.push(this.run(node.body));
        }
        result = {
          out: results
            .map((r) => r.out)
            .filter(Boolean)
            .join('\n'),
          err: results
            .map((r) => r.err)
            .filter(Boolean)
            .join('\n'),
          code: results.at(-1)?.code ?? 0,
        };
      }
      if (result.out) output.push(result.out);
      if (result.err) errors.push(result.err);
      code = result.code;
      this.variables['?'] = String(code);
    }
    return { out: output.join('\n'), err: errors.join('\n'), code };
  }
  private expand(word: string): string {
    let output = '',
      quote = '';
    for (let i = 0; i < word.length; i++) {
      const c = word[i];
      if (c === "'" && quote !== '"') {
        quote = quote === "'" ? '' : "'";
        continue;
      }
      if (c === '"' && quote !== "'") {
        quote = quote === '"' ? '' : '"';
        continue;
      }
      if (c === '\\' && quote !== "'") {
        output += word[++i] ?? '';
        continue;
      }
      if (c !== '$' || quote === "'") {
        output += c;
        continue;
      }
      if (word[i + 1] === '(') {
        let depth = 1,
          end = i + 2,
          innerQuote = '';
        for (; end < word.length && depth; end++) {
          const cc = word[end];
          if (cc === '\\') {
            end++;
            continue;
          }
          if (innerQuote) {
            if (cc === innerQuote) innerQuote = '';
            continue;
          }
          if (cc === '"' || cc === "'") {
            innerQuote = cc;
            continue;
          }
          if (cc === '(') depth++;
          if (cc === ')') depth--;
        }
        if (depth) throw new Error('unclosed substitution');
        const inner = word.slice(i + 2, end - 1);
        if (inner.startsWith('(') && inner.endsWith(')'))
          output += String(arithmetic(inner.slice(1, -1), this.variables));
        else output += this.run(new Parser(lex(inner)).parse()).out.replace(/\n+$/, '');
        i = end - 1;
      } else {
        const match = word.slice(i + 1).match(/^\{([A-Za-z_]\w*|\?)\}|^([A-Za-z_]\w*|\?)/);
        if (match) {
          output += this.variables[match[1] ?? match[2]] ?? '';
          i += match[0].length;
        } else output += '$';
      }
    }
    return output;
  }
  private pipeline(words: string[]): Result {
    const parts: string[][] = [[]];
    for (const word of words) {
      if (word === '|') parts.push([]);
      else parts.at(-1)!.push(word);
    }
    let input = '',
      result = ok();
    const errors: string[] = [];
    for (const part of parts) {
      if (!part.length) return fail('syntax error: empty pipeline');
      let redirect: { path: string; append: boolean } | undefined,
        quiet = false;
      const args: string[] = [];
      for (let i = 0; i < part.length; i++) {
        if (part[i] === '>' || part[i] === '>>') {
          if (!part[i + 1]) return fail('syntax error: missing redirection target');
          redirect = { path: this.expand(part[++i]), append: part[i - 1] === '>>' };
        } else if (part[i] === '2>') {
          if (this.expand(part[++i] || '') !== '/dev/null')
            return fail('only 2>/dev/null is supported');
          quiet = true;
        } else args.push(this.expand(part[i]));
      }
      result = this.command(args, input);
      if (quiet) result.err = '';
      if (result.err) errors.push(result.err);
      if (redirect) {
        const path = this.resolve(redirect.path);
        if (
          [
            '/etc/config/wireless',
            '/etc/config/network',
            '/var/log/messages',
            '/proc/uptime',
          ].includes(path)
        )
          return fail(
            `${redirect.path}: virtual system file; use the corresponding configuration commands`,
          );
        if (!this.directories.has(this.parent(path)))
          return fail(`${redirect.path}: No such directory`);
        if (this.directories.has(path)) return fail(`${redirect.path}: Is a directory`);
        this.files[path] =
          (redirect.append ? (this.read(path) ?? '') : '') + result.out + (result.out ? '\n' : '');
        result.out = '';
      }
      input = result.out;
    }
    result.err = errors.join('\n');
    return result;
  }
  private resolve(path: string): string {
    let value = path.replace(/\\/g, '/');
    if (value === '~' || value.startsWith('~/')) value = '/root' + value.slice(1);
    if (this.os === 'windows') {
      if (value.startsWith('/')) value = 'C:' + value;
      if (!/^[A-Za-z]:\//.test(value)) value = this.cwd + '/' + value;
      value = value.replace(/^c:/i, 'C:');
    } else if (!value.startsWith('/')) value = this.cwd + '/' + value;
    const pieces: string[] = [];
    for (const piece of value.split('/')) {
      if (!piece || piece === '.') continue;
      if (piece === '..') pieces.pop();
      else pieces.push(piece);
    }
    return this.os === 'windows'
      ? pieces.join('/') + (pieces.length === 1 ? '/' : '')
      : '/' + pieces.join('/');
  }
  private parent(path: string): string {
    return path.slice(0, path.lastIndexOf('/')) || '/';
  }
  private read(path: string): string | undefined {
    if (path === '/etc/config/wireless') return this.configFile(this.engine.state.config.committed);
    if (path === '/proc/uptime')
      return `${Math.floor((Date.now() - this.started) / 1000)}.00 0.00\n`;
    if (path === '/var/log/messages') return this.logs();
    if (path === '/etc/config/network')
      return this.configFile(this.engine.state.config.committed, 'network');
    return this.files[path];
  }
  private config(): Record<string, string> {
    const config = { ...this.engine.state.config.committed, ...this.engine.state.config.staged };
    for (const key in config) if (config[key] === '__DELETE__') delete config[key];
    return config;
  }
  private configFile(config: Record<string, string>, packageName = 'wireless'): string {
    const sections = [
      ...new Set(
        Object.keys(config)
          .filter((key) => key.startsWith(packageName + '.'))
          .map((key) => key.split('.')[1]),
      ),
    ];
    return (
      sections
        .map((section) => {
          const key = `${packageName}.${section}`;
          const type =
            config[key] ??
            (packageName === 'network'
              ? 'interface'
              : section.startsWith('MT7999')
                ? 'wifi-device'
                : 'wifi-iface');
          return (
            `config ${type} '${section}'\n` +
            Object.entries(config)
              .filter(([k]) => k.startsWith(key + '.'))
              .map(
                ([k, v]) =>
                  `\t${this.listKeys.has(k) ? 'list' : 'option'} ${k.split('.')[2]} '${v}'`,
              )
              .join('\n')
          );
        })
        .join('\n\n') + '\n'
    );
  }
  private sections(type: string): string[] {
    const config = this.config();
    return [...new Set(Object.keys(config).map((key) => key.split('.')[1]))].filter((section) => {
      const actual =
        config[`wireless.${section}`] ??
        (section.startsWith('MT7999') ? 'wifi-device' : 'wifi-iface');
      return actual === type;
    });
  }
  private uciKey(key: string): string {
    return key.replace(/@([\w-]+)\[(-?\d+)\]/, (_, type: string, number: string) => {
      const sections = this.sections(type),
        index = Number(number);
      return sections[index < 0 ? sections.length + index : index] ?? '__missing__';
    });
  }
  private uci(args: string[]): Result {
    const quiet = args.includes('-q');
    args = args.filter((arg) => arg !== '-q');
    const [action, raw = 'wireless', extra] = args;
    if (!action) return fail('Usage: uci get|show|set|add|add_list|delete|rename|changes|commit');
    if (args.length > 3)
      return quiet
        ? { ...fail('uci: too many arguments'), err: '' }
        : fail('uci: too many arguments');
    const config = this.config(),
      key = this.uciKey(raw.split('=')[0]);
    const error = (message: string) =>
      quiet ? { out: '', err: '', code: 1 } : fail(`uci: ${message}`);
    const packageName = raw.split('.')[0];
    if (!['wireless', 'network'].includes(packageName))
      return error('available packages: wireless, network');
    if (action === 'get') {
      let value = config[key];
      if (
        value === undefined &&
        key.split('.').length === 2 &&
        Object.keys(config).some((k) => k.startsWith(key + '.'))
      )
        value =
          packageName === 'network'
            ? 'interface'
            : key.includes('MT7999')
              ? 'wifi-device'
              : 'wifi-iface';
      return value === undefined ? error('Entry not found') : ok(value);
    }
    if (action === 'show') {
      const entries = Object.entries(config).filter(([k]) => k === key || k.startsWith(key + '.'));
      if (!entries.length) return error('Entry not found');
      return ok(
        entries.map(([k, v]) => `${k}=${k.split('.').length === 2 ? v : `'${v}'`}`).join('\n'),
      );
    }
    if (action === 'set' || action === 'add_list') {
      const equal = raw.indexOf('=');
      if (equal < 0 || key.split('.').length < 2)
        return error('Invalid argument: expected wireless.section.option=value');
      const value = raw.slice(equal + 1);
      if (action === 'add_list') this.listKeys.add(key);
      this.engine.stage(
        key,
        action === 'add_list' && config[key] ? `${config[key]} ${value}` : value,
      );
      return ok();
    }
    if (action === 'delete') {
      const keys = Object.keys(config).filter((k) => k === key || k.startsWith(key + '.'));
      if (!keys.length) return error('Entry not found');
      keys.forEach((k) => {
        this.engine.stage(k, '__DELETE__');
        this.listKeys.delete(k);
      });
      return ok();
    }
    if (action === 'add') {
      if (!extra || !['wifi-iface', 'wifi-device'].includes(extra))
        return error('expected: uci add wireless wifi-iface|wifi-device');
      let index = 0;
      while (
        Object.keys(config).some((k) =>
          k.startsWith(`wireless.cfg${String(index).padStart(6, '0')}`),
        )
      )
        index++;
      const section = `cfg${String(index).padStart(6, '0')}`;
      this.engine.stage(`wireless.${section}`, extra);
      return ok(section);
    }
    if (action === 'rename') {
      const name = raw.slice(raw.indexOf('=') + 1);
      if (!raw.includes('=') || !/^[\w-]+$/.test(name)) return error('Invalid argument');
      const prefix = key.slice(0, key.lastIndexOf('.') + 1),
        newKey = prefix + name;
      const keys = Object.keys(config).filter((k) => k === key || k.startsWith(key + '.'));
      if (!keys.length) return error('Entry not found');
      keys.forEach((k) => {
        this.engine.stage(newKey + k.slice(key.length), config[k]);
        this.engine.stage(k, '__DELETE__');
        if (this.listKeys.delete(k)) this.listKeys.add(newKey + k.slice(key.length));
      });
      return ok();
    }
    if (action === 'changes')
      return ok(
        Object.entries(this.engine.state.config.staged)
          .filter(([k]) => k.startsWith(packageName + '.'))
          .map(([k, v]) => (v === '__DELETE__' ? `-${k}` : `${k}='${v}'`))
          .join('\n'),
      );
    if (action === 'commit') {
      this.engine.commit(packageName);
      return ok();
    }
    return error(`unsupported command '${action}'`);
  }
  private logs(): string {
    const state = this.engine.state as unknown as {
      logs?: Array<{
        time?: string;
        timestamp?: string | number;
        source: string;
        level: string;
        message: string;
      }>;
    };
    return (state.logs ?? [])
      .map((log) => `${log.time ?? log.timestamp ?? ''} ${log.source}: ${log.level} ${log.message}`)
      .join('\n');
  }
  private wpa(args: string[]): string {
    const sta = this.engine.state.sta,
      network = this.engine.state.network;
    if (args[0] === 'quit' || args[0] === 'exit') {
      this.mode = 'shell';
      return '';
    }
    if (args[0] === 'status')
      return `wpa_state=${sta.status === 'connected' ? 'COMPLETED' : sta.status === 'restarting' ? 'INTERFACE_DISABLED' : sta.status === 'associating' ? 'ASSOCIATING' : sta.status === 'disconnected' ? 'DISCONNECTED' : 'SCANNING'}\nssid=${sta.ssid ?? this.engine.state.config.runtime['wireless.stamld0.ssid'] ?? ''}\nfreq=${sta.freq ?? 0}\nip_address=${sta.status === 'connected' ? network.dutIp : ''}\naddress=02:ff:00:2d:e3:63`;
    if (args[0] === 'scan') return this.engine.scan();
    if (args[0] === 'scan_results') return this.engine.scanResults();
    if (args[0] === 'ping') return 'PONG';
    if (args[0] === 'help') return 'status scan scan_results ping quit';
    return `Unknown command '${args[0] ?? ''}'. Use help.`;
  }
  private command(args: string[], input: string): Result {
    if (!args.length) return ok();
    if (/^[A-Za-z_]\w*=/.test(args[0])) {
      if (args.length !== 1)
        return fail('assignment before command is not supported; use separate statements');
      const index = args[0].indexOf('=');
      this.variables[args[0].slice(0, index)] = args[0].slice(index + 1);
      return ok();
    }
    const [command, ...rest] = args;
    const state = this.engine.state;
    if (command === 'true' || command === ':') return ok();
    if (command === 'false') return { out: '', err: '', code: 1 };
    if (command === '[' || command === 'test') {
      const values = command === '[' ? rest.slice(0, -1) : rest;
      if (command === '[' && rest.at(-1) !== ']') return fail('[: missing ]');
      let truth = false;
      if (values.length === 1) truth = Boolean(values[0]);
      else if (values.length === 2) {
        const [op, value] = values;
        if (op === '-n') truth = !!value;
        else if (op === '-z') truth = !value;
        else if (op === '-f') truth = this.read(this.resolve(value)) !== undefined;
        else if (op === '-d') truth = this.directories.has(this.resolve(value));
        else return fail(`test: unsupported operator '${op}'`);
      } else if (values.length === 3) {
        const [left, op, right] = values,
          a = Number(left),
          b = Number(right);
        if (op === '=' || op === '==') truth = left === right;
        else if (op === '!=') truth = left !== right;
        else if (['-eq', '-ne', '-gt', '-ge', '-lt', '-le'].includes(op)) {
          if (!Number.isFinite(a) || !Number.isFinite(b))
            return fail('test: integer expression expected');
          truth =
            op === '-eq'
              ? a === b
              : op === '-ne'
                ? a !== b
                : op === '-gt'
                  ? a > b
                  : op === '-ge'
                    ? a >= b
                    : op === '-lt'
                      ? a < b
                      : a <= b;
        } else return fail(`test: unsupported operator '${op}'`);
      } else if (values.length) return fail('test: unsupported expression');
      return { out: '', err: '', code: truth ? 0 : 1 };
    }
    if (command === 'help')
      return ok(
        `Simulated OpenWrt shell. Supported commands:\n${supportedCommands.join(' ')}\nBounded for/while/if, pipes, >, >>, variables and substitutions. Maximum 100 loop iterations.`,
      );
    if (command === 'pwd') return ok(this.cwd);
    if (command === 'cd') {
      const target = this.resolve(rest[0] || '/root');
      if (!this.directories.has(target)) return fail(`cd: ${rest[0]}: No such directory`);
      this.cwd = target;
      return ok();
    }
    if (command === 'ls') {
      const targets = rest.filter((arg) => !arg.startsWith('-'));
      const path = this.resolve(targets[0] || '.');
      if (this.read(path) !== undefined) return ok(path.split('/').at(-1));
      if (!this.directories.has(path)) return fail(`ls: ${targets[0]}: No such file or directory`);
      const knownFiles = [
        ...Object.keys(this.files),
        '/etc/config/wireless',
        '/etc/config/network',
        '/proc/uptime',
        '/var/log/messages',
      ];
      const children = [
        ...new Set(
          [...this.directories, ...knownFiles].filter((p) => p !== path && this.parent(p) === path),
        ),
      ].sort();
      return ok(
        children
          .map((p) =>
            rest.some((arg) => /^-.*l/.test(arg))
              ? `${this.directories.has(p) ? 'drwxr-xr-x' : '-rw-r--r--'} root root ${this.read(p)?.length ?? 0} ${p.split('/').at(-1)}`
              : p.split('/').at(-1),
          )
          .join(rest.includes('-l') ? '\n' : '  '),
      );
    }
    if (command === 'echo') return ok((rest[0] === '-n' ? rest.slice(1) : rest).join(' '));
    if (command === 'cat') {
      if (!rest.length) return ok(input);
      const contents: string[] = [];
      for (const file of rest) {
        const content = this.read(this.resolve(file));
        if (content === undefined) return fail(`cat: ${file}: No such file`);
        contents.push(content.replace(/\n$/, ''));
      }
      return ok(contents.join('\n'));
    }
    if (command === 'grep') {
      const flags = rest.filter((arg) => arg.startsWith('-')).join(''),
        values = rest.filter((arg) => !arg.startsWith('-'));
      if (!values.length) return fail('Usage: grep [-Eivn] pattern [file]');
      let source = input;
      if (values.length > 1) {
        const file = this.read(this.resolve(values[1]));
        if (file === undefined) return fail(`grep: ${values[1]}: No such file`);
        source = file;
      }
      try {
        const pattern = flags.includes('F')
          ? values[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          : values[0];
        if (pattern.length > 256 || /\([^)]*[|+*][^)]*\)[+*{]/.test(pattern))
          return fail('grep: expression exceeds safe simulator limit');
        const regex = new RegExp(pattern, flags.includes('i') ? 'i' : '');
        const lines = source
          .split('\n')
          .filter((line, i, all) => line !== '' || i < all.length - 1);
        const matches = lines.flatMap((line, index) =>
          regex.test(line) !== flags.includes('v')
            ? [flags.includes('n') ? `${index + 1}:${line}` : line]
            : [],
        );
        return {
          out: flags.includes('c') ? String(matches.length) : matches.join('\n'),
          err: '',
          code: matches.length ? 0 : 1,
        };
      } catch {
        return fail('grep: invalid regular expression');
      }
    }
    if (command === 'head' || command === 'tail') {
      let count = 10,
        filename: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '-n') count = Number(rest[++i]);
        else if (/^-\d+$/.test(rest[i])) count = Number(rest[i].slice(1));
        else filename = rest[i];
      }
      if (!Number.isInteger(count) || count < 0) return fail(`${command}: invalid line count`);
      const source = filename ? this.read(this.resolve(filename)) : input;
      if (source === undefined) return fail(`${command}: ${filename}: No such file`);
      const lines = source.replace(/\n$/, '').split('\n');
      return ok(
        (command === 'head' ? lines.slice(0, count) : count === 0 ? [] : lines.slice(-count)).join(
          '\n',
        ),
      );
    }
    if (command === 'touch' || command === 'mkdir') {
      const recursive = rest.includes('-p'),
        names = rest.filter((arg) => !arg.startsWith('-'));
      if (!names.length) return fail(`${command}: missing operand`);
      for (const name of names) {
        const path = this.resolve(name);
        if (command === 'mkdir' && this.read(path) !== undefined)
          return fail(`mkdir: ${name}: File exists`);
        if (
          command === 'touch' &&
          [
            '/etc/config/wireless',
            '/etc/config/network',
            '/var/log/messages',
            '/proc/uptime',
          ].includes(path)
        )
          return fail(`touch: ${name}: virtual system file`);
        if (recursive) {
          let current = '';
          for (const piece of path
            .split('/')
            .filter(Boolean)
            .slice(0, command === 'mkdir' ? undefined : -1)) {
            current += '/' + piece;
            this.directories.add(current);
          }
        }
        if (!this.directories.has(this.parent(path)))
          return fail(`${command}: ${name}: No such parent directory`);
        if (command === 'mkdir') {
          if (this.directories.has(path) && !recursive) return fail(`mkdir: ${name}: File exists`);
          this.directories.add(path);
        } else {
          if (this.directories.has(path)) return fail(`touch: ${name}: Is a directory`);
          this.files[path] ??= '';
        }
      }
      return ok();
    }
    if (command === 'cp' || command === 'mv') {
      if (rest.length !== 2) return fail(`${command}: expected source and destination`);
      const source = this.resolve(rest[0]),
        target = this.resolve(rest[1]);
      const content = this.read(source);
      if (content === undefined) return fail(`${command}: ${rest[0]}: No such file`);
      const final = this.directories.has(target) ? target + '/' + source.split('/').at(-1) : target;
      if (!this.directories.has(this.parent(final)))
        return fail(`${command}: destination directory does not exist`);
      if (
        [
          '/etc/config/wireless',
          '/etc/config/network',
          '/var/log/messages',
          '/proc/uptime',
        ].includes(final)
      )
        return fail(`${command}: destination is a virtual system file; use configuration commands`);
      if (source === final) return fail(`${command}: source and destination are the same file`);
      if (source === '/etc/config/wireless' && command === 'mv')
        return fail('mv: protected configuration; copy a backup or use uci');
      this.files[final] = content;
      if (command === 'mv') delete this.files[source];
      return ok();
    }
    if (command === 'rm') {
      const recursive = rest.some((arg) => /^-.*r/.test(arg)),
        force = rest.some((arg) => /^-.*f/.test(arg));
      const names = rest.filter((arg) => !arg.startsWith('-'));
      if (!names.length) return fail('rm: missing operand');
      for (const name of names) {
        const path = this.resolve(name);
        if (
          ['/', '/etc', '/etc/config', '/etc/config/wireless', '/etc/config/network'].includes(path)
        )
          return fail('rm: protected virtual system path');
        if (this.directories.has(path)) {
          if (!recursive) return fail(`rm: ${name}: Is a directory`);
          for (const file in this.files) if (file.startsWith(path + '/')) delete this.files[file];
          for (const dir of this.directories)
            if (dir === path || dir.startsWith(path + '/')) this.directories.delete(dir);
        } else if (this.files[path] !== undefined) delete this.files[path];
        else if (!force) return fail(`rm: ${name}: No such file`);
      }
      return ok();
    }
    if (command === 'find') {
      const root = this.resolve(rest[0] || '.'),
        index = rest.indexOf('-name');
      const pattern = index >= 0 ? rest[index + 1] : '*';
      if (!pattern) return fail('find: missing -name pattern');
      const regex = new RegExp(
        '^' +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.') +
          '$',
      );
      return ok(
        [
          ...this.directories,
          ...Object.keys(this.files),
          '/etc/config/wireless',
          '/etc/config/network',
        ]
          .filter(
            (p) =>
              (root === '/' || p === root || p.startsWith(root + '/')) &&
              regex.test(p.split('/').at(-1) || '/'),
          )
          .sort()
          .join('\n'),
      );
    }
    if (command === 'clear') {
      this.clearRequested = true;
      return ok();
    }
    if (command === 'history')
      return ok(this.history.map((entry, index) => `${index + 1}  ${entry}`).join('\n'));
    if (command === 'date') return ok(new Date().toISOString());
    if (command === 'uptime')
      return ok(
        `up ${Math.floor((Date.now() - this.started) / 60000)} min, load average: 0.00, 0.00, 0.00`,
      );
    if (command === 'whoami') return ok('root');
    if (command === 'ps')
      return ok(
        'PID USER COMMAND\n' +
          Object.entries(this.processes)
            .map(([id, process]) => `${id} root ${process}`)
            .join('\n'),
      );
    if (command === 'kill') {
      const id = rest.filter((arg) => !arg.startsWith('-'))[0];
      if (!this.processes[id]) return fail(`kill: (${id}) - No such process`);
      if (id === '1') return fail('kill: virtual init cannot be terminated');
      if (this.processes[id].includes('iperf3')) {
        state.network.dutServerRunning = false;
        this.engine.log('iperf3', 'INFO', 'DUT server terminated by kill');
      } else
        return fail(
          'kill: infrastructure process control is outside this simulator; use wifi restart',
        );
      delete this.processes[id];
      return ok();
    }
    if (command === 'sleep') {
      const duration = Number(rest[0]);
      if (rest.length !== 1 || !Number.isFinite(duration) || duration < 0 || duration > 3600)
        return fail('sleep: expected simulated seconds from 0 to 3600');
      this.engine.tick(duration);
      return ok();
    }
    if (command === 'sh' || command === 'ash') {
      const source = this.read(this.resolve(rest[0] || ''));
      if (source === undefined) return fail(`sh: ${rest[0]}: No such file`);
      return this.run(new Parser(lex(source)).parse());
    }
    if (command === 'uci') return this.uci(rest);
    if (command === 'sync') return ok();
    if (command === 'wifi') {
      if (rest[0] !== 'restart' && rest[0] !== 'reload') return fail('Usage: wifi restart|reload');
      this.engine.restart(false);
      return ok('Wireless subsystem restarting...');
    }
    if (command === 'reboot') {
      this.mode = 'shell';
      this.engine.restart(true);
      return ok(
        'Broadcast message: The system is going down for reboot NOW!\nSerial connection retained. Await virtual DUT boot.',
      );
    }
    if (command === 'wpa_cli') {
      let interfaceName = 'stamld0';
      const commands = [...rest];
      const interfaceIndex = commands.indexOf('-i');
      if (interfaceIndex >= 0) {
        interfaceName = commands[interfaceIndex + 1];
        commands.splice(interfaceIndex, 2);
      }
      if (interfaceName !== 'stamld0')
        return fail(
          `Failed to connect to non-global ctrl_ifname: ${interfaceName}\nNo such virtual interface`,
        );
      if (!commands.length) {
        this.mode = 'wpa';
        return ok(
          'wpa_cli v2.11 (simulated)\nInteractive mode\nUse status, scan, scan_results, quit.',
        );
      }
      return ok(this.wpa(commands));
    }
    if (command === 'iw') {
      if (rest.join(' ') === 'dev') return ok('phy#1\n\tInterface stamld0\n\t\ttype managed');
      if (rest[0] !== 'dev' || rest[1] !== 'stamld0')
        return fail('iw: No such device (-19); expected dev stamld0');
      if (rest[2] === 'link') {
        if (state.sta.status !== 'connected') return ok('Not connected.');
        return ok(
          `Connected to ${state.sta.bssid} (on stamld0)\n\tSSID: ${state.sta.ssid}\n\tfreq: ${state.sta.freq}\n\tsignal: ${state.sta.rssi} dBm\n\trx bitrate: ${state.sta.phyRate.toFixed(1)} MBit/s (PHY, not throughput)\n\ttx bitrate: ${state.sta.phyRate.toFixed(1)} MBit/s\n\tMCS ${state.sta.mcs}, NSS ${state.sta.nss}`,
        );
      }
      if (rest[2] === 'scan') {
        const scan = this.engine.scan();
        if (scan !== 'OK') return fail('command failed: Device or resource busy (-16)');
        const rows = this.engine.scanResults().split('\n').slice(1).filter(Boolean);
        return ok(
          rows
            .map((row) => {
              const [bssid, frequency, signal, , ssid] = row.split(/\t/);
              return `BSS ${bssid}(on stamld0)\n\tfreq: ${frequency}\n\tsignal: ${signal} dBm\n\tSSID: ${ssid}`;
            })
            .join('\n'),
        );
      }
      if (rest[2] === 'info')
        return ok(
          `Interface stamld0\n\ttype managed\n\tchannel ${state.ap.channel} (${state.sta.freq} MHz)`,
        );
      return fail(`iw: unsupported operation '${rest.slice(2).join(' ')}'`);
    }
    if (command === 'iwconfig')
      return ok(
        `stamld0  IEEE 802.11  ESSID:"${state.sta.ssid ?? state.config.runtime['wireless.stamld0.ssid'] ?? ''}"\n         Mode:Managed  Frequency:${(state.sta.freq / 1000).toFixed(3)} GHz\n         Access Point: ${state.sta.status === 'connected' ? state.sta.bssid : 'Not-Associated'}\n         Signal level=${state.sta.rssi} dBm\nlo       no wireless extensions.\neth2     no wireless extensions.`,
      );
    if (command === 'ip') return this.ip(rest);
    if (command === 'bridge') {
      if (rest[0] === 'link')
        return ok(
          `3: stamld0 state ${state.sta.status === 'connected' ? 'forwarding' : 'disabled'} master br-lan\n4: eth2 state ${state.network.bypass ? 'forwarding' : 'disabled'} master br-lan`,
        );
      if (rest[0] === 'fdb')
        return ok(
          `04:42:1a:5c:44:b2 dev ${state.network.bypass ? 'eth2' : 'stamld0'} offload master br-lan\n02:ff:00:2d:e3:63 dev stamld0 self permanent`,
        );
      return fail('Usage: bridge link show | bridge fdb show br br-lan');
    }
    if (command === 'ping') {
      const index = rest.indexOf('-c'),
        count = index < 0 ? 4 : Number(rest[index + 1]);
      const target = rest
        .filter((arg, i) => !arg.startsWith('-') && (index < 0 || i !== index + 1))
        .at(-1);
      if (!target || !Number.isInteger(count) || count < 1 || count > 20)
        return fail('Usage: ping [-c 1..20] host (simulator bounds each run)');
      const output = this.engine.ping(target, count, 'linux');
      return {
        out: output,
        err: '',
        code: output.includes('0% packet loss') && !output.includes('100%') ? 0 : 1,
      };
    }
    if (command === 'iperf3') {
      const output = this.engine.iperf(rest, 'linux');
      if (rest.includes('-s') && !output.toLowerCase().includes('error'))
        this.processes['901'] = 'iperf3 -s ' + rest.join(' ');
      return {
        out: output,
        err: '',
        code: output.toLowerCase().includes('error') || output.startsWith('Usage:') ? 1 : 0,
      };
    }
    if (command === 'logread' || command === 'dmesg') return ok(this.logs());
    return fail(`-ash: ${command}: not found`);
  }
  private ip(args: string[]): Result {
    args = args.filter((arg) => arg !== '-4');
    const { network, sta } = this.engine.state;
    const [action, sub] = args;
    if (action === '-s' && sub === 'link') {
      const interfaceName = args.at(-1) === 'eth2' ? 'eth2' : 'stamld0',
        bytes = interfaceName === 'eth2' ? network.ethernetBytes : network.wifiBytes;
      return ok(
        `${interfaceName}: <BROADCAST,MULTICAST,UP>\n    RX: bytes packets errors dropped\n    ${bytes} ${Math.floor(bytes / 1500)} 0 0\n    TX: bytes packets errors dropped\n    ${bytes} ${Math.floor(bytes / 1500)} 0 0`,
      );
    }
    if (action === 'addr' || action === 'address' || action === 'a') {
      if (sub === 'add')
        return fail('ip addr add: change DUT address with the network panel in this version');
      return ok(
        `1: lo: <LOOPBACK,UP>\n    inet 127.0.0.1/8 scope host lo\n5: br-lan: <BROADCAST,MULTICAST,UP>\n    inet ${network.dutIp}/24 scope global br-lan\n    inet 192.168.88.5/24 scope global br-lan`,
      );
    }
    if (action === 'route' || action === 'r') {
      if (sub === 'get')
        return ok(`${args[2] || network.serverIp} dev br-lan src ${network.dutIp}\n    cache`);
      return ok(
        `192.168.1.0/24 dev br-lan proto kernel scope link src ${network.dutIp}\n192.168.88.0/24 dev br-lan scope link src 192.168.88.5`,
      );
    }
    if (action === 'neigh' || action === 'neighbor')
      return ok(
        `${network.serverIp} dev br-lan lladdr 04:42:1a:5c:44:b2 ${sta.status === 'connected' || network.bypass ? 'REACHABLE' : 'FAILED'}`,
      );
    if (action === 'link')
      return ok(
        `3: stamld0: <BROADCAST,MULTICAST,${sta.status === 'connected' ? 'UP,LOWER_UP' : 'UP'}>\n4: eth2: <BROADCAST,MULTICAST,${network.bypass ? 'UP,LOWER_UP' : 'UP'}>\n5: br-lan: <BROADCAST,MULTICAST,UP>`,
      );
    return fail('ip: supported queries: addr, route, route get, neigh, link, -s link');
  }
  private windows(source: string): string {
    const outputs: string[] = [];
    // CMD uses backslash paths and independent commands; it intentionally does not inherit ash syntax.
    for (const line of source.split(/\r?\n/).filter(Boolean)) {
      const args = (line.match(/"[^"]*"|[^\s]+/g) ?? []).map((value) =>
        value.replace(/^"|"$/g, ''),
      );
      const command = args.shift()?.toLowerCase() ?? '',
        state = this.engine.state;
      if (!command) continue;
      if (command === 'cls') {
        this.clearRequested = true;
        continue;
      }
      if (command === 'help') outputs.push(`Supported CMD commands: ${windowsCommands.join(' ')}`);
      else if (command === 'echo') outputs.push(args.join(' '));
      else if (command === 'cd' || command === 'chdir') {
        if (!args.length) outputs.push(this.cwd.replace(/\//g, '\\'));
        else {
          const path = this.resolve(args.filter((arg) => arg !== '/d')[0]);
          if (this.directories.has(path)) this.cwd = path;
          else outputs.push('The system cannot find the path specified.');
        }
      } else if (command === 'dir') {
        const path = this.resolve(args[0] || '.');
        if (!this.directories.has(path)) outputs.push('File Not Found');
        else
          outputs.push(
            `Directory of ${path.replace(/\//g, '\\')}\n` +
              [...this.directories, ...Object.keys(this.files)]
                .filter((p) => p !== path && this.parent(p) === path)
                .map(
                  (p) =>
                    `${this.directories.has(p) ? '<DIR>' : this.files[p].length}  ${p.split('/').at(-1)}`,
                )
                .join('\n'),
          );
      } else if (command === 'type')
        outputs.push(
          this.read(this.resolve(args[0] || '')) ?? 'The system cannot find the file specified.',
        );
      else if (command === 'ipconfig')
        outputs.push(
          `Windows IP Configuration\n\nEthernet adapter Ethernet (PC → AP LAN):\n   IPv4 Address. . . . . . . . . . . : ${state.network.pcIp}\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.1.1\n\nWireless adapter Wi-Fi: Media disconnected`,
        );
      else if (command === 'ping') {
        const i = args.indexOf('-n'),
          count = i < 0 ? 4 : Number(args[i + 1]),
          target = args.filter((a, j) => !a.startsWith('-') && (i < 0 || j !== i + 1)).at(-1);
        outputs.push(
          target && Number.isInteger(count) && count > 0 && count <= 20
            ? this.engine.ping(target, count, 'windows')
            : 'Usage: ping [-n 1..20] host',
        );
      } else if (command === 'tracert') {
        const target = args.at(-1);
        const reachable =
          target === state.network.serverIp ||
          (target === state.network.dutIp &&
            (state.sta.status === 'connected' || state.network.bypass));
        outputs.push(
          `Tracing route to ${target || 'unknown'}\n  1    ${reachable ? '<1 ms    <1 ms    <1 ms    ' + target : '*        *        *     Request timed out.'}\nTrace complete.`,
        );
      } else if (command === 'netstat')
        outputs.push(
          `Active Connections\nProto Local Address Foreign Address State\n${state.network.serverRunning ? `TCP   ${state.network.serverIp}:${state.network.serverPort}   0.0.0.0:0   LISTENING` : 'No listening iperf3 server.'}`,
        );
      else if (command === 'netsh' && args[0]?.toLowerCase() === 'wlan')
        outputs.push(
          args.slice(1).join(' ').toLowerCase().startsWith('show')
            ? 'There is no wireless interface on this virtual Windows PC.\nPC uses Ethernet to AP; the DUT Wi-Fi interface is queried in Tera Term.'
            : 'Usage: netsh wlan show interfaces|networks',
        );
      else if (command === 'iperf3' || command === 'iperf3.exe')
        outputs.push(this.engine.iperf(args, 'windows'));
      else
        outputs.push(
          `'${command}' is not recognized as an internal or external command,\noperable program or batch file.`,
        );
    }
    return outputs.join('\n');
  }
}
