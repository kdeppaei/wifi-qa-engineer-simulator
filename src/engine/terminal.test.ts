import { describe, expect, it } from 'vitest';
import { LabEngine } from './lab';
import { TerminalSession } from './terminal';

function fixture() {
  const initial: Record<string, string> = {
    'wireless.MT7999_1_2': 'wifi-device',
    'wireless.MT7999_1_2.channel': '36',
    'wireless.MT7999_1_2.etxbfencond': '3',
    'wireless.MT7999_1_3': 'wifi-device',
    'wireless.MT7999_1_3.channel': '37',
    'wireless.stamld0': 'wifi-iface',
    'wireless.stamld0.mode': 'sta',
    'wireless.stamld0.device': 'MT7999_1_3',
    'wireless.stamld0.ssid': 'BN68_6G',
    'wireless.ap0': 'wifi-iface',
    'wireless.ap0.mode': 'ap',
  };
  const engine = {
    state: {
      config: {
        staged: {} as Record<string, string>,
        committed: { ...initial },
        runtime: { ...initial },
      },
      sta: { status: 'connected', rssi: -43, freq: 6135 },
      attenuation: { db: 0 },
      network: {
        serverIp: '192.168.1.200',
        serverRunning: true,
        serverPort: 9002,
        bypass: false,
        pcIp: '192.168.1.200',
        dutIp: '192.168.1.5',
        wifiBytes: 1024,
        ethernetBytes: 0,
      },
      logs: [{ source: 'wpa_supplicant', level: 'INFO', message: 'stamld0 connected' }],
    },
    stage(key: string, value: string) {
      this.state.config.staged[key] = value;
    },
    commit() {
      for (const [key, value] of Object.entries(this.state.config.staged)) {
        if (value === '__DELETE__') delete this.state.config.committed[key];
        else this.state.config.committed[key] = value;
      }
      this.state.config.staged = {};
    },
    restart() {
      this.state.config.runtime = { ...this.state.config.committed };
    },
    scan: () => 'OK',
    scanResults: () =>
      'bssid / frequency / signal level / flags / ssid\n02:ff:00:2d:e3:63\t5180\t-43\t[SAE]\tBN68',
    ping(target: string, count: number, origin: string) {
      return `${origin} PING ${target}: ${count} transmitted, ${count} received, 0% packet loss`;
    },
    iperf: (args: string[]) =>
      args.includes('-R') ? 'DL [SUM] 800 Mbits/sec receiver' : 'UL [SUM] 700 Mbits/sec receiver',
    log(source: string, level: string, message: string) {
      this.state.logs.push({ source, level, message });
    },
  };
  return { engine, terminal: new TerminalSession(engine as unknown as LabEngine, 'linux') };
}

describe('terminal parser and persistent virtual environment', () => {
  it('writes files, pipes their data, appends lines and restores snapshots', () => {
    const { terminal, engine } = fixture();
    expect(
      terminal.execute(
        "mkdir results; cd results; echo 'first line' > report.txt; echo 'error evidence' >> report.txt; cat report.txt | grep error",
      ),
    ).toBe('error evidence');
    expect(terminal.execute('pwd')).toBe('/root/results');
    const restored = new TerminalSession(
      engine as unknown as LabEngine,
      'linux',
      terminal.snapshot(),
    );
    expect(restored.execute('cat report.txt | head -1')).toBe('first line');
    expect(
      restored.execute(
        'cp report.txt copy.txt; mv copy.txt moved.txt; rm report.txt; cat moved.txt | tail -1',
      ),
    ).toBe('error evidence');
    expect(restored.execute('find . -name "*.txt"')).toBe('/root/results/moved.txt');
  });

  it('respects quotes, comments, variables, command substitution and arithmetic', () => {
    const { terminal } = fixture();
    expect(
      terminal.execute(
        "name='BN68'; echo '$name;literal'; echo \"$name\"; # ignored\nx=$(echo 7); x=$((x * 3 - 1)); echo ${x}",
      ),
    ).toBe('$name;literal\nBN68\n20');
    expect(terminal.execute('echo "$(echo nested)"')).toBe('nested');
  });

  it('supports conditional execution without pretending failed commands succeeded', () => {
    const { terminal } = fixture();
    expect(
      terminal.execute(
        'false && echo hidden; true || echo hidden; [ 3 -gt 2 ] && echo yes; if [ -f absent ]; then echo bad; else echo fallback; fi',
      ),
    ).toBe('yes\nfallback');
    expect(terminal.execute('cat missing 2>/dev/null; echo $?')).toBe('1');
    expect(terminal.execute('not_a_tool')).toContain('not_a_tool: not found');
  });

  it('executes the actual backwards APCLI cleanup loop from the handbook', () => {
    const { terminal, engine } = fixture();
    const script = `idx=66
while [ $idx -ge 0 ]; do
  mode=$(uci get wireless.@wifi-iface[$idx].mode 2>/dev/null)
  if [ "$mode" = "sta" ]; then
    uci -q delete wireless.@wifi-iface[$idx]
  fi
  idx=$((idx - 1))
done
uci commit wireless`;
    expect(terminal.execute(script)).toBe('');
    expect(engine.state.config.committed['wireless.stamld0.mode']).toBeUndefined();
    expect(engine.state.config.committed['wireless.ap0.mode']).toBe('ap');
    expect(terminal.execute('echo $idx')).toBe('-1');
  });

  it('adds anonymous UCI sections, renames them and iterates configuration values', () => {
    const { terminal } = fixture();
    expect(
      terminal.execute(
        'section=$(uci add wireless wifi-iface); uci set wireless.$section.mode=sta; uci rename wireless.$section=teststa; uci get wireless.teststa.mode',
      ),
    ).toBe('sta');
    expect(terminal.execute('for n in 1 2 3; do echo $n; done')).toBe('1\n2\n3');
  });

  it('keeps staged, committed and runtime UCI states separate', () => {
    const { terminal, engine } = fixture();
    terminal.execute('uci set wireless.MT7999_1_2.etxbfencond=0');
    expect(terminal.execute('uci get wireless.MT7999_1_2.etxbfencond')).toBe('0');
    expect(engine.state.config.committed['wireless.MT7999_1_2.etxbfencond']).toBe('3');
    expect(terminal.execute('cat /etc/config/wireless')).toContain("option etxbfencond '3'");
    terminal.execute('uci commit wireless');
    expect(engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('3');
    terminal.execute('wifi restart');
    expect(engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('0');
  });

  it('allows configuration backups and refuses unsupported direct system-file mutation', () => {
    const { terminal } = fixture();
    expect(terminal.execute('cp /etc/config/wireless /etc/config/wireless.bak')).toBe('');
    expect(terminal.execute('cat /etc/config/wireless.bak')).toContain(
      "config wifi-iface 'stamld0'",
    );
    expect(terminal.execute('cp /etc/config/wireless.bak /etc/config/wireless')).toContain(
      'virtual system file',
    );
    expect(terminal.execute('echo broken > /etc/config/wireless')).toContain('virtual system file');
    expect(terminal.execute('mkdir /etc/config/wireless')).toContain('File exists');
    expect(terminal.execute('cat /etc/config/wireless')).toContain('BN68_6G');
  });

  it('preserves the handbook device list structure for 6 GHz to 5 GHz migration', () => {
    const { terminal, engine } = fixture();
    expect(
      terminal.execute(
        "uci set wireless.stamld0.ssid='BN68'; uci -q delete wireless.stamld0.device; uci add_list wireless.stamld0.device='MT7999_1_2'; uci commit wireless; sync; wifi restart",
      ),
    ).toContain('restarting');
    expect(engine.state.config.runtime['wireless.stamld0.device']).toBe('MT7999_1_2');
    expect(terminal.execute('cat /etc/config/wireless')).toContain("list device 'MT7999_1_2'");
    expect(terminal.execute('uci changes wireless')).toBe('');
  });

  it('bounds loops and rejects malformed or unsafe syntax', () => {
    const { terminal } = fixture();
    expect(terminal.execute('while true; do echo looping; done')).toContain(
      'maximum 100 iterations',
    );
    expect(terminal.execute('if true; then echo incomplete')).toContain("expected 'fi'");
    expect(terminal.execute('echo "unterminated')).toContain('unclosed quote');
    expect(terminal.execute('x=$((1 / 0))')).toContain('division by zero');
    expect(terminal.execute('x=$((globalThis.alert(1)))')).toContain('unsupported expression');
    expect(terminal.execute('cat < input')).toContain('unsupported shell syntax');
  });

  it('passes network commands to the shared engine, including ping without flags', () => {
    const { terminal } = fixture();
    expect(terminal.execute('ping 192.168.1.200')).toContain('linux PING 192.168.1.200: 4');
    expect(terminal.execute('ping -c 2 192.168.1.200')).toContain('2 transmitted');
    expect(terminal.execute('iperf3 -c 192.168.1.200 -p 9002 -R')).toContain('DL');
    expect(terminal.execute('ip -s link show stamld0')).toContain('1024');
    expect(terminal.execute("logread | grep -Ei 'wpa|fail' | tail -40")).toContain(
      'stamld0 connected',
    );
  });

  it('keeps scan failures visible through pipes', () => {
    const { terminal, engine } = fixture();
    engine.scan = () => 'FAIL-BUSY';
    expect(terminal.execute("iw dev stamld0 scan | grep -E 'SSID:|freq:'")).toContain(
      'resource busy',
    );
    expect(terminal.execute('wpa_cli -i stamld0 scan')).toBe('FAIL-BUSY');
  });

  it('provides a real wpa_cli interactive context and validates interface names', () => {
    const { terminal } = fixture();
    expect(terminal.execute('scan_results')).toContain('not found');
    expect(terminal.execute('wpa_cli -i atamld0 status')).toContain('No such virtual interface');
    terminal.execute('wpa_cli -i stamld0');
    expect(terminal.mode).toBe('wpa');
    expect(terminal.execute('status')).toContain('wpa_state=COMPLETED');
    expect(terminal.execute('scan_results')).toContain('BN68');
    terminal.execute('quit');
    expect(terminal.mode).toBe('shell');
  });

  it('keeps Windows CMD separate from OpenWrt while sharing network state', () => {
    const { engine } = fixture();
    const terminal = new TerminalSession(engine as unknown as LabEngine, 'windows');
    expect(terminal.execute('ipconfig')).toContain('192.168.1.200');
    expect(terminal.execute('ping 192.168.1.5')).toContain('windows PING 192.168.1.5');
    expect(terminal.execute('uci get wireless.stamld0.ssid')).toContain('not recognized');
    expect(terminal.execute('netsh wlan show interfaces')).toContain('no wireless interface');
    expect(terminal.execute('netstat -ano')).toContain('9002');
    terminal.execute('cls');
    expect(terminal.clearRequested).toBe(true);
    terminal.execute('dir');
    expect(terminal.clearRequested).toBe(false);
  });
});

describe('terminal commands integrated with physical and test state', () => {
  it('migrates 6 GHz to 5 GHz only after persistent configuration is applied', () => {
    const engine = new LabEngine(),
      terminal = new TerminalSession(engine, 'linux');
    engine.updateAP({ band: '5', ssid: 'BN68', channel: 36 });
    expect(terminal.execute('iw dev stamld0 link')).toBe('Not connected.');
    terminal.execute(
      "uci set wireless.stamld0.ssid='BN68'; uci -q delete wireless.stamld0.device; uci add_list wireless.stamld0.device='MT7999_1_2'",
    );
    expect(engine.state.config.runtime['wireless.stamld0.ssid']).toBe('BN68_6G');
    terminal.execute('uci commit wireless; wifi restart; sleep 6');
    expect(terminal.execute('iw dev stamld0 link')).toContain('freq: 5180');
    expect(terminal.execute('iw dev stamld0 link')).toContain('SSID: BN68');
    expect(terminal.execute('ping -c 4 192.168.1.200')).toContain('0% packet loss');
  });

  it('reflects high attenuation in WPA, ping, logs and MSP, then recovers gradually', () => {
    const engine = new LabEngine(),
      terminal = new TerminalSession(engine, 'linux');
    engine.reset('5');
    expect(engine.startTest()).toContain('Started');
    engine.tick(3);
    engine.setAttenuation(90);
    expect(engine.state.msp.status).toBe('interrupted');
    expect(terminal.execute('iw dev stamld0 link')).toBe('Not connected.');
    expect(terminal.execute('wpa_cli -i stamld0 scan_results').split('\n')).toHaveLength(1);
    expect(terminal.execute('ping -c 4 192.168.1.200')).toContain('100% packet loss');
    terminal.execute('sleep 3');
    expect(terminal.execute('logread | grep NETWORK-NOT-FOUND')).toContain('NETWORK-NOT-FOUND');
    engine.setAttenuation(0);
    expect(engine.state.sta.status).not.toBe('connected');
    terminal.execute('sleep 9');
    expect(terminal.execute('iw dev stamld0 link')).toContain('Connected');
    expect(engine.state.msp.runs[0].status).toBe('interrupted');
    expect(engine.state.msp.runs[0].points.length).toBeGreaterThan(0);
  });

  it('separates Linux and Windows iperf3 server processes and counters', () => {
    const engine = new LabEngine(),
      linux = new TerminalSession(engine, 'linux'),
      windows = new TerminalSession(engine, 'windows');
    expect(windows.execute('iperf3 -c 192.168.1.5 -p 9002')).toContain('Connection refused');
    expect(linux.execute('iperf3 -s -p 9002')).toContain('Server listening');
    expect(windows.execute('iperf3 -c 192.168.1.5 -p 9002 -P 4')).toContain('AP → STA');
    expect(engine.state.network.wifiBytes).toBeGreaterThan(0);
    linux.execute('kill 901');
    expect(engine.state.network.dutServerRunning).toBe(false);
    expect(engine.state.network.serverRunning).toBe(true);
    expect(linux.execute('iperf3 -c 192.168.1.200 -p 9002 -R')).toContain('AP → STA');
  });
});
