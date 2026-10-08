import { bandForRadio, type LabState, type TestRun } from './lab';

interface Pipeline {
  stages: string[][];
  guarded: boolean;
  redirected: boolean;
}

/** Inspect the bounded shell grammar without executing commands or trusting words in echo/history. */
function tokenize(source: string): string[] | null {
  const tokens: string[] = [];
  let word = '',
    quote = '';
  const flush = () => {
    if (word) tokens.push(word);
    word = '';
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\' && quote !== "'") {
      word += source[++i] ?? '';
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
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
    if ('|&>'.includes(c)) {
      flush();
      if (source[i + 1] === c) {
        tokens.push(c + c);
        i++;
      } else tokens.push(c);
      continue;
    }
    word += c;
  }
  if (quote) return null;
  flush();
  return tokens;
}

function parsePipelines(source: string, os: 'linux' | 'windows'): Pipeline[] {
  if (os === 'windows')
    return source
      .split(/\r?\n/)
      .map((line) => ({
        stages: [(line.match(/"[^"]*"|[^\s]+/g) ?? []).map((word) => word.replace(/^"|"$/g, ''))],
        guarded: false,
        redirected: false,
      }));
  const tokens = tokenize(source);
  if (
    !tokens ||
    tokens.some((t) => ['if', 'then', 'else', 'fi', 'for', 'while', 'do', 'done'].includes(t))
  )
    return [];
  const result: Pipeline[] = [];
  let stages: string[][] = [],
    words: string[] = [],
    guarded = false,
    redirected = false;
  const finish = () => {
    if (words.length) stages.push(words);
    if (stages.length) result.push({ stages, guarded, redirected });
    stages = [];
    words = [];
    redirected = false;
  };
  for (const token of tokens) {
    if (token === '|') {
      stages.push(words);
      words = [];
    } else if ([';', '&&', '||', '&'].includes(token)) {
      finish();
      guarded = token !== ';';
    } else {
      if (token === '>' || token === '>>') redirected = true;
      words.push(token);
    }
  }
  finish();
  return result;
}

function safeFilters(stages: string[][]): boolean {
  return stages.every(([command, ...args]) => {
    if (command === 'cat') return args.length === 0;
    if (command === 'grep') return args.filter((a) => !a.startsWith('-')).length === 1;
    if (command === 'head' || command === 'tail') {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && /^\d+$/.test(args[i + 1] ?? '')) i++;
        else if (!/^-\d+$/.test(args[i])) return false;
      }
      return true;
    }
    return false;
  });
}

const failedCommand = (output: string): boolean =>
  /(^|\n)(?:-ash:|Usage:|Unknown command|Failed to connect|command failed:|iperf3: (?:error|parameter error)|(?:uci|iw|grep|cat|mkdir|touch|cp|mv|rm):|'.*' is not recognized)/i.test(
    output,
  );

/** Return plain semantic tags. The UI stores raw commands as command:* and these tags as evidence:*. */
export function observeCommand(source: string, output: string, os: 'linux' | 'windows'): string[] {
  const pipelines = parsePipelines(source, os);
  const tags = new Set<string>();
  const failed = failedCommand(output);
  for (const pipeline of pipelines) {
    if (pipeline.guarded || !pipeline.stages[0]?.length || !safeFilters(pipeline.stages.slice(1)))
      continue;
    const [rawCommand, ...args] = pipeline.stages[0];
    const command = os === 'windows' ? rawCommand.toLowerCase() : rawCommand;
    if (
      !command ||
      command === 'history' ||
      command === 'rem' ||
      command.startsWith('::') ||
      command.includes('$')
    )
      continue;
    const busyScan =
      os === 'linux' &&
      command === 'iw' &&
      args[0] === 'dev' &&
      args[1] === 'stamld0' &&
      args[2] === 'scan' &&
      /^command failed: Device or resource busy \(-16\)$/.test(output.trim());
    if (failed && !busyScan) continue;
    if (pipeline.redirected) {
      if (os === 'linux' && command === 'echo' && output.trim() === '') tags.add('filesystem-ok');
      continue;
    }
    if (os === 'linux') {
      const counted =
        pipeline.stages
          .slice(1)
          .some((stage) => stage[0] === 'grep' && stage.some((a) => /^-.*c/.test(a))) &&
        /^\d+$/.test(output.trim());
      const linkShape =
        /Connected to |Not connected\.|(?:^|\n)\s*(?:SSID:|freq:|signal:|[rt]x bitrate:)|wpa_state=|stamld0\s+IEEE 802\.11/.test(
          output,
        ) || counted;
      if (
        command === 'iw' &&
        args[0] === 'dev' &&
        args[1] === 'stamld0' &&
        args[2] === 'link' &&
        linkShape
      )
        tags.add('link-query');
      if (command === 'iwconfig' && (!args.length || args[0] === 'stamld0') && linkShape)
        tags.add('link-query');
      if (command === 'status' && /wpa_state=/.test(output)) tags.add('link-query');
      const wpaArgs = [...args];
      const iface = wpaArgs.indexOf('-i');
      const validIface = iface < 0 || wpaArgs[iface + 1] === 'stamld0';
      if (iface >= 0) wpaArgs.splice(iface, 2);
      if (command === 'wpa_cli' && validIface && wpaArgs[0] === 'status' && linkShape)
        tags.add('link-query');
      const scanResults =
        /bssid \/ frequency \/ signal level \/ flags \/ ssid|(?:^|\n)BSS |(?:^|\n)\s*(?:SSID:|freq:)|^FAIL-BUSY$|^OK$/.test(
          output.trim(),
        ) || counted;
      if (
        (command === 'wpa_cli' && validIface && ['scan', 'scan_results'].includes(wpaArgs[0])) ||
        ['scan', 'scan_results'].includes(command)
      ) {
        if (scanResults) tags.add('scan-query');
      }
      if (
        command === 'iw' &&
        args[0] === 'dev' &&
        args[1] === 'stamld0' &&
        args[2] === 'scan' &&
        (scanResults || output.trim() === '' || /Device or resource busy \(-16\)/.test(output))
      )
        tags.add('scan-query');
      const logShape =
        /(?:^|\n)(?:\d+(?:\.\d+)?\s+(?:wpa_supplicant|DUT|UCI|LAB|MSP|ATTENUATOR|iperf3|AP):|.*CTRL-EVENT-|.*NETWORK-NOT-FOUND)/.test(
          output,
        ) || counted;
      if (
        (['logread', 'dmesg'].includes(command) ||
          (command === 'cat' && args.length === 1 && args[0] === '/var/log/messages')) &&
        logShape
      )
        tags.add('log-query');
      if (
        ['mkdir', 'touch', 'cp', 'mv'].includes(command) &&
        args.some((a) => !a.startsWith('-')) &&
        output.trim() === ''
      )
        tags.add('filesystem-ok');
      if (
        command === 'cat' &&
        args.length === 1 &&
        pipeline.stages.slice(1).some((stage) => stage[0] === 'grep') &&
        output.trim()
      )
        tags.add('filesystem-filter-ok');
      if (
        command === 'uci' &&
        args.filter((a) => a !== '-q').some((a) => ['get', 'show'].includes(a)) &&
        output.trim()
      )
        tags.add('uci-query');
    }
    if (command === 'ping' && os === 'linux' && args.at(-1) === '192.168.1.200') {
      const header = output.match(/--- 192\.168\.1\.200 ping statistics ---\s*\n([^\n]+)/);
      const multiplePings = pipelines.filter((p) => p.stages[0]?.[0] === 'ping').length > 1;
      const stats = (header?.[1] ?? (multiplePings ? '' : output)).match(
        /(\d+) packets transmitted,\s*(\d+) (?:packets )?received,\s*0% packet loss/,
      );
      if (stats && Number(stats[1]) > 0 && stats[1] === stats[2]) tags.add('server-ping-ok');
    }
    if (command === 'iperf3' || (os === 'windows' && command === 'iperf3.exe')) {
      if (!args.includes('-c') && !args.includes('--client')) continue;
      if (/BYPASS|Ethernet bypass|WARNING:/i.test(output) || !/path stamld0/.test(output)) continue;
      const rate = output.match(/([\d.]+) Mbits\/sec[^\n]*receiver/);
      if (!rate || Number(rate[1]) <= 0 || !/iperf Done\./.test(output)) continue;
      const reverse = args.includes('-R') || args.includes('--reverse');
      const direction = os === 'linux' ? (reverse ? 'DL' : 'UL') : reverse ? 'UL' : 'DL';
      if (output.includes(`Wireless direction: ${direction}`))
        tags.add(direction === 'DL' ? 'iperf-dl-ok' : 'iperf-ul-ok');
    }
  }
  return [...tags];
}

function activeStation(runtime: Record<string, string>): { prefix: string; radio: string } {
  const prefixes = Object.keys(runtime)
    .filter((key) => key.startsWith('wireless.') && key.endsWith('.mode') && runtime[key] === 'sta')
    .map((key) => key.slice(0, -5));
  const prefix =
    prefixes.find((key) => key === 'wireless.stamld0') ??
    prefixes.find((key) => runtime[`${key}.ifname`] === 'stamld0') ??
    prefixes[0] ??
    'wireless.stamld0';
  const radio = (runtime[`${prefix}.device`] ?? '').replace(/["']/g, '').split(/\s+/)[0];
  return { prefix, radio };
}

function fullyApplied(state: LabState): boolean {
  return (
    Object.keys(state.config.staged).length === 0 &&
    [
      ...new Set([...Object.keys(state.config.committed), ...Object.keys(state.config.runtime)]),
    ].every((key) => state.config.committed[key] === state.config.runtime[key])
  );
}

function completeRun(run: TestRun, bf?: boolean, band?: string): boolean {
  if (
    run.status !== 'completed' ||
    (bf !== undefined && run.bf !== bf) ||
    (band && run.metadata.band !== band) ||
    run.points.length < 2 ||
    run.settings.end <= run.settings.start ||
    run.error
  )
    return false;
  const points = run.points;
  if (
    Math.abs(points[0].attenuation - run.settings.start) > 0.01 ||
    Math.abs(points.at(-1)!.attenuation - run.settings.end) > 0.01
  )
    return false;
  if (
    run.metadata.network.bypass ||
    !points.every(
      (point, i) =>
        point.bf === run.bf &&
        Number.isFinite(point.throughput) &&
        point.throughput > 0 &&
        (i === 0 || point.attenuation > points[i - 1].attenuation),
    )
  )
    return false;
  if (run.direction === 'DL' && run.metadata.ap.txbf !== run.bf) return false;
  const { radio } = activeStation(run.metadata.runtime);
  return !band || bandForRadio(radio) === band;
}

const settingsKeys = [
  'direction',
  'protocol',
  'start',
  'end',
  'step',
  'lowStep',
  'threshold',
  'duration',
  'streams',
  'port',
  'serverIp',
  'seed',
] as const;
function comparablePair(a: TestRun, b: TestRun): boolean {
  if (
    a.direction !== 'DL' ||
    b.direction !== 'DL' ||
    !completeRun(a, true, '5') ||
    !completeRun(b, false, '5')
  )
    return false;
  if (!settingsKeys.every((key) => a.settings[key] === b.settings[key])) return false;
  if (
    !(Object.keys(a.metadata.ap) as (keyof typeof a.metadata.ap)[])
      .filter((key) => key !== 'txbf')
      .every((key) => a.metadata.ap[key] === b.metadata.ap[key])
  )
    return false;
  if (
    !(Object.keys(a.metadata.network) as (keyof typeof a.metadata.network)[]).every(
      (key) => a.metadata.network[key] === b.metadata.network[key],
    )
  )
    return false;
  if (
    a.metadata.configuredWidth !== b.metadata.configuredWidth ||
    a.metadata.negotiatedWidth !== b.metadata.negotiatedWidth
  )
    return false;
  const stationA = activeStation(a.metadata.runtime),
    stationB = activeStation(b.metadata.runtime);
  if (stationA.radio !== stationB.radio) return false;
  const stationKeys = [
    'device',
    'ssid',
    'network',
    'mode',
    'encryption',
    'key',
    'ieee80211w',
    'disabled',
  ];
  if (
    !stationKeys.every(
      (key) =>
        a.metadata.runtime[`${stationA.prefix}.${key}`] ===
        b.metadata.runtime[`${stationB.prefix}.${key}`],
    )
  )
    return false;
  return ['channel', 'htmode', 'band', 'nss', 'disabled'].every(
    (key) =>
      a.metadata.runtime[`wireless.${stationA.radio}.${key}`] ===
      b.metadata.runtime[`wireless.${stationB.radio}.${key}`],
  );
}

/** Acceptance uses current causal state and observer-generated tags, never arbitrary history substrings. */
export function assessChapter(chapter: number, state: LabState, evidence: string[]): boolean {
  const tags = new Set(
    evidence.filter((entry) => entry.startsWith('evidence:')).map((entry) => entry.slice(9)),
  );
  const connected = state.sta.status === 'connected';
  const { prefix, radio } = activeStation(state.config.runtime);
  const runtimeBF = state.config.runtime[`wireless.${radio}.etxbfencond`];
  const five =
    connected &&
    state.ap.band === '5' &&
    bandForRadio(radio) === '5' &&
    state.sta.freq >= 5000 &&
    state.sta.freq < 5950;
  const runs = state.msp.runs;
  switch (chapter) {
    case 1:
      return connected && !state.network.bypass && tags.has('server-ping-ok');
    case 2:
      return tags.has('filesystem-ok') && tags.has('filesystem-filter-ok');
    case 3:
      return runtimeBF === '0' && fullyApplied(state);
    case 4:
      return (
        connected &&
        tags.has('link-query') &&
        tags.has('uci-query') &&
        state.config.runtime[`${prefix}.mode`] === 'sta' &&
        state.config.runtime[`${prefix}.ssid`] === state.ap.ssid &&
        bandForRadio(radio) === state.ap.band
      );
    case 5:
      return (
        five &&
        runtimeBF === '0' &&
        fullyApplied(state) &&
        runs.some((on) => runs.some((off) => comparablePair(on, off)))
      );
    case 6:
      return (
        connected && !state.network.bypass && tags.has('iperf-ul-ok') && tags.has('iperf-dl-ok')
      );
    case 7:
      return runs.some((run) => run.direction === 'DL' && completeRun(run, true, '5'));
    case 8:
      return runs.some((run) => run.direction === 'DL' && completeRun(run, false, '5'));
    case 9:
      return (
        connected && tags.has('link-query') && (tags.has('scan-query') || tags.has('log-query'))
      );
    case 10:
      return (
        state.network.serverRunning &&
        state.network.serverPort === state.msp.settings.port &&
        state.network.serverIp === state.msp.settings.serverIp &&
        runs.some(
          (run) =>
            completeRun(run) &&
            run.settings.port === state.network.serverPort &&
            run.settings.serverIp === state.network.serverIp,
        )
      );
    default:
      return false;
  }
}
