import { describe, expect, it } from 'vitest';
import { LabEngine, type TestSettings } from './lab';
import { TerminalSession } from './terminal';
import { assessChapter, observeCommand } from './scenario';

function make() {
  const engine = new LabEngine();
  engine.reset('5');
  return {
    engine,
    linux: new TerminalSession(engine, 'linux'),
    windows: new TerminalSession(engine, 'windows'),
  };
}
const evidence = (...tags: string[]) => tags.map((tag) => `evidence:${tag}`);
function observe(session: TerminalSession, source: string, os: 'linux' | 'windows' = 'linux') {
  return observeCommand(source, session.execute(source), os);
}
function completePair(
  offSettings: Partial<TestSettings> = {},
  changeAP?: (engine: LabEngine) => void,
) {
  const { engine } = make();
  engine.startTest({ end: 10, duration: 1 });
  engine.tick(3);
  engine.setAttenuation(0);
  engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
  engine.commit();
  engine.restart();
  engine.tick(6);
  engine.updateAP({ txbf: false });
  changeAP?.(engine);
  if (engine.state.sta.status !== 'connected') engine.tick(5);
  engine.startTest({ end: 10, duration: 1, ...offSettings });
  engine.tick(30);
  return engine;
}

describe('semantic evidence observer', () => {
  it('rejects echo, comments, history and quoted command text', () => {
    const { linux } = make();
    for (const source of [
      'echo ping',
      'echo logread',
      'echo "iw dev stamld0 link"',
      '# iw dev stamld0 link\n# logread',
      'history',
      'echo "Connected to 02:ff:00:2d:e3:63" | grep Connected',
    ])
      expect(observe(linux, source)).toEqual([]);
    expect(
      observeCommand('echo logread', '0 wpa_supplicant: CTRL-EVENT-NETWORK-NOT-FOUND', 'linux'),
    ).toEqual([]);
    expect(
      observeCommand(
        'false && iw dev stamld0 link; echo "Connected to 02:ff:00:2d:e3:63"',
        'Connected to 02:ff:00:2d:e3:63',
        'linux',
      ),
    ).toEqual([]);
    expect(
      observeCommand(
        'if false; then logread; fi',
        '0 wpa_supplicant: CTRL-EVENT-NETWORK-NOT-FOUND',
        'linux',
      ),
    ).toEqual([]);
  });

  it('recognizes actual link queries and safe pipelines', () => {
    const { linux } = make();
    expect(observe(linux, 'iw dev stamld0 link')).toContain('link-query');
    expect(observe(linux, 'iw dev stamld0 link | grep -E "SSID:|signal:"')).toContain('link-query');
    expect(observe(linux, 'iwconfig')).toContain('link-query');
    expect(observe(linux, 'wpa_cli -i stamld0 status')).toContain('link-query');
    linux.execute('wpa_cli -i stamld0');
    expect(observe(linux, 'status')).toContain('link-query');
    linux.execute('quit');
    expect(observe(linux, 'iw dev atamld0 link')).not.toContain('link-query');
    expect(observe(linux, 'iw dev stamld0 link | echo "Connected to fake"')).not.toContain(
      'link-query',
    );
    linux.execute('echo "Connected to fake" > /root/fake.txt');
    expect(observe(linux, 'iw dev stamld0 link | grep Connected /root/fake.txt')).not.toContain(
      'link-query',
    );
  });

  it('accepts negative link and scan observations as diagnostic evidence', () => {
    const { engine, linux } = make();
    engine.setAttenuation(90);
    expect(observe(linux, 'iw dev stamld0 link')).toContain('link-query');
    expect(observe(linux, 'wpa_cli -i stamld0 scan_results')).toContain('scan-query');
    engine.tick();
    expect(observe(linux, 'iw dev stamld0 scan')).toContain('scan-query');
    expect(observe(linux, "logread | grep -Ei 'stamld0|wpa|fail' | tail -40")).toContain(
      'log-query',
    );
    expect(observe(linux, 'cat /var/log/messages')).toContain('log-query');
    expect(observe(linux, 'logread | grep no-such-record')).not.toContain('log-query');
  });

  it('requires successful DUT-to-server ping and avoids 100% loss substring mistakes', () => {
    const { engine, linux, windows } = make();
    expect(observe(linux, 'ping -c 4 192.168.1.200')).toContain('server-ping-ok');
    expect(observe(linux, 'ping -c 4 192.168.1.200 | grep "packet loss"')).toContain(
      'server-ping-ok',
    );
    expect(observe(linux, 'ping 192.168.1.5')).not.toContain('server-ping-ok');
    expect(observe(windows, 'ping 192.168.1.200', 'windows')).not.toContain('server-ping-ok');
    engine.setAttenuation(90);
    expect(observe(linux, 'ping 192.168.1.200')).not.toContain('server-ping-ok');
    expect(observe(linux, 'ping 192.168.1.200; ping 192.168.1.5')).not.toContain('server-ping-ok');
    expect(
      observeCommand(
        'echo "4 packets transmitted, 4 packets received, 0% packet loss"',
        '4 packets transmitted, 4 packets received, 0% packet loss',
        'linux',
      ),
    ).toEqual([]);
  });

  it('distinguishes iperf UL/DL by sender location and rejects failures or Ethernet bypass', () => {
    const { engine, linux, windows } = make();
    expect(observe(linux, 'iperf3 -c 192.168.1.200 -p 9002')).toContain('iperf-ul-ok');
    expect(observe(linux, 'iperf3 -c 192.168.1.200 -p 9002 -R')).toContain('iperf-dl-ok');
    expect(observe(linux, 'iperf3 -c 192.168.1.200')).toEqual([]);
    linux.execute('iperf3 -s -p 9002');
    expect(observe(windows, 'iperf3.exe -c 192.168.1.5 -p 9002', 'windows')).toContain(
      'iperf-dl-ok',
    );
    expect(observe(windows, 'iperf3 -c 192.168.1.5 -p 9002 -R', 'windows')).toContain(
      'iperf-ul-ok',
    );
    engine.state.network.bypass = true;
    expect(observe(linux, 'iperf3 -c 192.168.1.200 -p 9002 -R')).toEqual([]);
  });

  it('recognizes successful filesystem creation and actual file filtering', () => {
    const { engine, linux } = make();
    const created = observe(linux, 'mkdir /root/qa');
    const written = observe(linux, 'echo "hello Wi-Fi" > /root/qa/result.txt');
    const filtered = observe(linux, 'cat /root/qa/result.txt | grep Wi-Fi');
    expect(created).toContain('filesystem-ok');
    expect(written).toContain('filesystem-ok');
    expect(filtered).toContain('filesystem-filter-ok');
    expect(observe(linux, 'mkdir /missing/parent/qa')).toEqual([]);
    expect(observe(linux, 'cat /root/missing.txt | grep hello')).toEqual([]);
    expect(assessChapter(2, engine.state, evidence(...created, ...filtered))).toBe(true);
    expect(assessChapter(2, engine.state, evidence(...created))).toBe(false);
  });
});

describe('chapter acceptance from state and typed evidence', () => {
  it('does not score command/history strings or plain untrusted tag text', () => {
    const { engine } = make();
    expect(
      assessChapter(1, engine.state, ['echo ping', 'command:ping 192.168.1.200', 'server-ping-ok']),
    ).toBe(false);
    expect(
      assessChapter(9, engine.state, [
        'command:evidence:link-query',
        'command:evidence:log-query',
        'link-query',
        'echo logread',
      ]),
    ).toBe(false);
    expect(assessChapter(1, engine.state, evidence('server-ping-ok'))).toBe(true);
    engine.state.network.bypass = true;
    expect(assessChapter(1, engine.state, evidence('server-ping-ok'))).toBe(false);
  });

  it('requires the active radio BF and all staged/committed/runtime layers to agree', () => {
    const { engine } = make();
    engine.stage('wireless.MT7999_1_3.etxbfencond', '0');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(assessChapter(3, engine.state, [])).toBe(false);
    engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
    expect(assessChapter(3, engine.state, [])).toBe(false);
    engine.commit();
    expect(assessChapter(3, engine.state, [])).toBe(false);
    engine.restart();
    engine.tick(6);
    expect(assessChapter(3, engine.state, [])).toBe(true);
    engine.stage('network.lan.proto', 'dhcp');
    expect(assessChapter(3, engine.state, [])).toBe(false);
    engine.commit('network');
    expect(assessChapter(3, engine.state, [])).toBe(false);
  });

  it('requires actual APCLI config/link observations and both traffic directions for practice goals', () => {
    const { engine, linux } = make();
    expect(assessChapter(4, engine.state, [])).toBe(false);
    const tags = [...observe(linux, 'uci show wireless.stamld0'), ...observe(linux, 'iwconfig')];
    expect(assessChapter(4, engine.state, evidence(...tags))).toBe(true);
    const ul = observe(linux, 'iperf3 -c 192.168.1.200 -p 9002');
    const dl = observe(linux, 'iperf3 -c 192.168.1.200 -p 9002 -R');
    expect(assessChapter(6, engine.state, evidence(...ul))).toBe(false);
    expect(assessChapter(6, engine.state, evidence(...ul, ...dl))).toBe(true);
  });

  it('accepts a comparable complete 5G DL pair with expected STA BF differences', () => {
    const engine = completePair();
    expect(engine.state.msp.runs.map((run) => run.status)).toEqual(['completed', 'completed']);
    expect(assessChapter(5, engine.state, [])).toBe(true);
    expect(assessChapter(7, engine.state, [])).toBe(true);
    expect(assessChapter(8, engine.state, [])).toBe(true);
    engine.stage('wireless.MT7999_1_2.etxbfencond', '3');
    expect(assessChapter(5, engine.state, [])).toBe(false);
  });

  it('rejects mismatched seed, channel, backhaul, streams, range and protocol pairs', () => {
    expect(assessChapter(5, completePair({ seed: 81 }).state, [])).toBe(false);
    expect(
      assessChapter(5, completePair({}, (engine) => engine.updateAP({ channel: 44 })).state, []),
    ).toBe(false);
    expect(
      assessChapter(
        5,
        completePair({}, (engine) => {
          engine.state.network.ethernetMbps = 1000;
        }).state,
        [],
      ),
    ).toBe(false);
    expect(assessChapter(5, completePair({ streams: 1 }).state, [])).toBe(false);
    expect(assessChapter(5, completePair({ end: 15 }).state, [])).toBe(false);
    expect(assessChapter(5, completePair({ protocol: 'UDP' }).state, [])).toBe(false);
  });

  it('rejects one-point, interrupted, non-DL and non-5GHz runs', () => {
    const { engine } = make();
    engine.startTest({ start: 0, end: 0, duration: 1 });
    engine.tick();
    engine.updateAP({ txbf: false });
    engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
    engine.commit();
    engine.restart();
    engine.tick(6);
    engine.startTest({ start: 0, end: 0, duration: 1 });
    engine.tick();
    expect(assessChapter(5, engine.state, [])).toBe(false);
    expect(assessChapter(7, engine.state, [])).toBe(false);
    expect(assessChapter(8, engine.state, [])).toBe(false);
    const pair = completePair();
    pair.state.msp.runs[1].status = 'interrupted';
    expect(assessChapter(5, pair.state, [])).toBe(false);
    const six = new LabEngine();
    six.startTest({ end: 10, duration: 1 });
    six.tick(3);
    expect(assessChapter(7, six.state, [])).toBe(false);
    const ul = make().engine;
    ul.startTest({ direction: 'UL', end: 10, duration: 1 });
    ul.tick(3);
    expect(assessChapter(7, ul.state, [])).toBe(false);
  });

  it('requires actual diagnostic observations plus current recovered link for chapter9', () => {
    const { engine, linux } = make();
    engine.setAttenuation(90);
    const tags = [
      ...observe(linux, 'iw dev stamld0 link'),
      ...observe(linux, 'wpa_cli -i stamld0 scan_results'),
    ];
    expect(assessChapter(9, engine.state, evidence(...tags))).toBe(false);
    engine.setAttenuation(0);
    engine.tick(5);
    expect(assessChapter(9, engine.state, evidence(...tags))).toBe(true);
    expect(assessChapter(9, engine.state, evidence('link-query'))).toBe(false);
    expect(
      assessChapter(9, engine.state, ['command:echo logread', 'command:echo iw dev stamld0 link']),
    ).toBe(false);
  });

  it('requires a complete multi-point run and the correct active listener for chapter10', () => {
    const { engine } = make();
    expect(assessChapter(10, engine.state, [])).toBe(false);
    engine.startTest({ end: 5, duration: 1 });
    engine.tick(2);
    expect(assessChapter(10, engine.state, [])).toBe(true);
    engine.state.network.serverRunning = false;
    expect(assessChapter(10, engine.state, [])).toBe(false);
    engine.state.network.serverRunning = true;
    engine.state.network.serverPort = 5201;
    expect(assessChapter(10, engine.state, [])).toBe(false);
  });
});
