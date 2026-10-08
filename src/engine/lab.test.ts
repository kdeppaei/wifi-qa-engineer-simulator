import { describe, expect, it } from 'vitest';
import { LabEngine, type Band, type TestSettings } from './lab';

const make = (band: Band = '5'): LabEngine => {
  const engine = new LabEngine();
  engine.reset(band);
  return engine;
};
const runAt = (engine: LabEngine, db = 40, partial: Partial<TestSettings> = {}) => {
  engine.setAttenuation(db);
  expect(engine.startTest({ start: db, end: db, duration: 1, seed: 42, ...partial })).toMatch(
    /^Started/,
  );
  engine.tick();
  return engine.state.msp.runs.at(-1)!;
};

describe('shared Wi-Fi lab state machine', () => {
  it('90 dB drops the STA, breaks ping and MSP, and preserves partial evidence', () => {
    const engine = make();
    engine.startTest({ end: 60, duration: 1 });
    engine.tick();
    const first = { ...engine.state.msp.runs[0].points[0] };
    engine.setAttenuation(90);
    expect(engine.state.sta.status).toBe('disconnected');
    expect(engine.state.sta.throughput).toBe(0);
    expect(engine.state.sta.reason).toContain('NETWORK-NOT-FOUND');
    expect(engine.state.msp.status).toBe('interrupted');
    expect(engine.state.msp.runs[0].error).toContain('NETWORK-NOT-FOUND');
    expect(engine.state.msp.runs[0].points).toEqual([first]);
    expect(engine.ping('192.168.1.200')).toContain('100% packet loss');
    expect(engine.scanResults().split('\n')).toHaveLength(1);
    expect(engine.state.logs.some((entry) => entry.message.includes('Exception'))).toBe(true);
    engine.tick();
    expect(engine.state.sta.status).toBe('scanning');
    expect(engine.scan()).toBe('FAIL-BUSY');
    engine.tick(2);
    expect(
      engine.state.logs.some((entry) => entry.message.includes('CTRL-EVENT-NETWORK-NOT-FOUND')),
    ).toBe(true);
  });

  it('returning attenuation to start recovers through scan and association without auto-resuming MSP', () => {
    const engine = make();
    engine.startTest({ duration: 1 });
    engine.setAttenuation(90);
    engine.setAttenuation(0);
    expect(engine.state.sta.status).toBe('disconnected');
    engine.tick();
    expect(engine.state.sta.status).toBe('scanning');
    engine.tick(2);
    expect(engine.state.sta.status).toBe('associating');
    engine.tick(2);
    expect(engine.state.sta.status).toBe('connected');
    expect(engine.ping('192.168.1.200')).toContain('0% packet loss');
    expect(engine.state.msp.status).toBe('interrupted');
  });

  it('separates pending, committed and applied driver values', () => {
    const engine = make();
    const key = 'wireless.MT7999_1_2.etxbfencond';
    engine.stage(key, '0');
    expect(engine.state.config.staged[key]).toBe('0');
    expect(engine.state.config.committed[key]).toBe('3');
    expect(engine.state.config.runtime[key]).toBe('3');
    engine.commit();
    expect(engine.state.config.staged[key]).toBeUndefined();
    expect(engine.state.config.committed[key]).toBe('0');
    expect(engine.state.config.runtime[key]).toBe('3');
    engine.restart();
    expect(engine.state.config.runtime[key]).toBe('0');
    expect(engine.state.sta.status).toBe('restarting');
    engine.tick(6);
    expect(engine.state.sta.status).toBe('connected');
  });

  it('commits only the named package and discards pending changes at reboot', () => {
    const engine = make();
    engine.stage('network.lan.ipaddr', '192.168.2.5');
    engine.stage('wireless.stamld0.ssid', 'wrong');
    engine.commit('wireless');
    expect(engine.state.config.staged['network.lan.ipaddr']).toBe('192.168.2.5');
    expect(engine.state.config.committed['network.lan.ipaddr']).toBe('192.168.1.5');
    engine.restart(true);
    expect(engine.state.config.staged).toEqual({});
    engine.tick(9);
    expect(engine.state.sta.reason).toContain('SSID-MISMATCH');
  });

  it('changes both device and SSID when moving 6 GHz to 5 GHz', () => {
    const engine = make('6');
    engine.updateAP({ band: '5', channel: 36, ssid: 'BN68' });
    engine.tick(3);
    expect(engine.state.sta.reason).toContain('NETWORK-NOT-FOUND');
    engine.stage('wireless.stamld0.ssid', 'BN68');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.reason).toContain('NETWORK-NOT-FOUND');
    engine.stage('wireless.stamld0.device', '__DELETE__');
    engine.stage('wireless.stamld0.device', 'MT7999_1_2');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.status).toBe('connected');
    expect(engine.state.sta.ssid).toBe('BN68');
    expect(engine.state.sta.freq).toBe(5180);
  });

  it('reports SSID, authentication and AP power failures separately', () => {
    const engine = make();
    engine.updateAP({ ssid: 'OTHER' });
    expect(engine.state.sta.reason).toContain('SSID-MISMATCH');
    // A real visible SSID can appear in scan results even when no configured network matches it.
    engine.tick(3);
    expect(engine.scanResults()).toContain('OTHER');
    engine.updateAP({ ssid: 'BN68', password: 'different-key' });
    engine.tick(7);
    expect(engine.state.sta.reason).toContain('AUTH-REJECT');
    engine.updateAP({ password: 'qa-lab-2026' });
    engine.tick(5);
    expect(engine.state.sta.status).toBe('connected');
    engine.updateAP({ power: false });
    expect(engine.state.sta.reason).toBe('NETWORK-NOT-FOUND: No suitable network found');
    engine.updateAP({ power: true });
    engine.tick(5);
    expect(engine.state.sta.status).toBe('connected');
  });

  it('channel switching scans and associates again, rejects invalid channels, and negotiates supported width', () => {
    const engine = make();
    engine.updateAP({ channel: 44, width: 320 });
    expect(engine.state.sta.status).toBe('disconnected');
    expect(engine.state.ap.width).toBe(160);
    engine.tick(5);
    expect(engine.state.sta.status).toBe('connected');
    expect(engine.state.sta.freq).toBe(5220);
    expect(runAt(engine, 0).metadata.negotiatedWidth).toBe(160);
    expect(engine.state.msp.runs[0].metadata.configuredWidth).toBe('UHR240');
    engine.updateAP({ channel: -1 });
    expect(engine.state.sta.status).toBe('disconnected');
    expect(engine.scanResults().split('\n')).toHaveLength(1);
  });

  it('does not let matching security names conceal an encryption mismatch', () => {
    const engine = make();
    engine.updateAP({ security: 'WPA2' });
    expect(engine.state.sta.reason).toContain('encryption sae does not match WPA2');
    engine.stage('wireless.stamld0.encryption', 'psk2');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.status).toBe('connected');
  });

  it('treats restart at high attenuation as persisted config plus RF failure', () => {
    const engine = make();
    engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
    engine.commit();
    engine.setAttenuation(90);
    engine.restart(true);
    engine.tick(9);
    expect(engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('0');
    expect(engine.state.sta.status).not.toBe('connected');
    expect(engine.state.attenuation.db).toBe(90);
    engine.setAttenuation(0);
    engine.tick(5);
    expect(engine.state.sta.status).toBe('connected');
    expect(engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('0');
  });

  it('uses AP TxBF for DL and applied STA TxBF for UL', () => {
    const on = make();
    const dlOn = runAt(on, 40, { direction: 'DL' });
    const staOff = make();
    staOff.stage('wireless.MT7999_1_2.etxbfencond', '0');
    staOff.commit();
    staOff.restart();
    staOff.tick(6);
    const dlStaOff = runAt(staOff, 40, { direction: 'DL' });
    expect(dlStaOff.bf).toBe(true);
    expect(dlStaOff.points[0].throughput).toBe(dlOn.points[0].throughput);
    const apOff = make();
    apOff.updateAP({ txbf: false });
    const dlApOff = runAt(apOff, 40, { direction: 'DL' });
    expect(dlApOff.bf).toBe(false);
    expect(dlApOff.points[0].throughput).toBeLessThan(dlOn.points[0].throughput);
    const ulOn = runAt(on, 40, { direction: 'UL' });
    const ulOff = runAt(staOff, 40, { direction: 'UL' });
    expect(ulOff.bf).toBe(false);
    expect(ulOff.points[0].throughput).toBeLessThan(ulOn.points[0].throughput);
    expect(ulOn.metadata.transmitter).toBe('STA');
    expect(dlOn.metadata.transmitter).toBe('AP');
  });

  it('requires actual attenuator readback at start and stops at a genuine RF failure', () => {
    const engine = make();
    engine.setAttenuation(60);
    expect(engine.startTest({ start: 0 })).toContain('ATTENUATOR-NOT-AT-START');
    engine.setAttenuation(0);
    expect(
      engine.startTest({ end: 90, duration: 1, step: 10, lowStep: 1, threshold: 400 }),
    ).toMatch(/^Started/);
    engine.tick(100);
    const run = engine.state.msp.runs[0];
    expect(run.status).toBe('interrupted');
    expect(run.error).toContain('NETWORK-NOT-FOUND');
    expect(run.points.length).toBeGreaterThan(5);
    expect(run.points.every((point) => point.throughput > 0)).toBe(true);
    expect(run.points.at(-1)!.attenuation).toBeLessThan(90);
  });

  it('measures sequentially, uses a finer low-throughput step, and retains final attenuation', () => {
    const engine = make();
    engine.startTest({ end: 15, duration: 2, step: 5, lowStep: 1, threshold: 10_000 });
    engine.tick();
    expect(engine.state.msp.runs[0].points).toHaveLength(0);
    engine.tick();
    expect(engine.state.msp.runs[0].points[0].attenuation).toBe(0);
    expect(engine.state.attenuation.db).toBe(1);
    engine.tick(30);
    expect(engine.state.msp.status).toBe('completed');
    expect(engine.state.attenuation.db).toBe(15);
    expect(engine.state.msp.runs[0].points).toHaveLength(16);
    expect(engine.state.network.wifiBytes).toBeGreaterThan(0);
    expect(engine.startTest()).toContain('ATTENUATOR-NOT-AT-START');
  });

  it('reproduces raw data with a fixed seed, includes MCS/PHY/backhaul, and snapshots metadata', () => {
    const first = make();
    const second = make();
    const a = runAt(first, 40, { seed: 101 });
    const b = runAt(second, 40, { seed: 101 });
    expect(a.points).toEqual(b.points);
    expect(a.points[0].phyRate).toBeGreaterThan(a.points[0].throughput);
    first.updateAP({ ssid: 'later' });
    first.state.config.runtime['wireless.stamld0.ssid'] = 'later';
    expect(a.metadata.ap.ssid).toBe('BN68');
    expect(a.metadata.runtime['wireless.stamld0.ssid']).toBe('BN68');
    const limited = make();
    limited.state.network.ethernetMbps = 100;
    expect(runAt(limited, 0).points[0].throughput).toBeLessThanOrEqual(94);
    const other = make();
    expect(runAt(other, 40, { seed: 102 }).points[0].throughput).not.toBe(b.points[0].throughput);
  });

  it('parallel streams influence achieved throughput without changing PHY rate', () => {
    const single = runAt(make(), 40, { streams: 1 }).points[0];
    const parallel = runAt(make(), 40, { streams: 20 }).points[0];
    expect(parallel.throughput).toBeGreaterThan(single.throughput);
    expect(parallel.phyRate).toBe(single.phyRate);
    expect(parallel.mcs).toBe(single.mcs);
  });

  it('interrupts settings or backhaul changes so raw points cannot diverge from their metadata', () => {
    const settings = make();
    settings.startTest();
    settings.tick();
    settings.state.msp.settings.direction = 'UL';
    settings.tick();
    expect(settings.state.msp.runs[0].error).toContain('MSP-SETTINGS-CHANGED');
    expect(settings.state.msp.runs[0].points).toHaveLength(0);
    const backhaul = make();
    backhaul.startTest();
    backhaul.tick();
    backhaul.state.network.ethernetMbps = 100;
    backhaul.tick();
    expect(backhaul.state.msp.runs[0].error).toContain('BACKHAUL-CHANGED');
  });

  it('distinguishes association, IP routing, and Ethernet bypass from a valid Wi-Fi test', () => {
    const engine = make();
    engine.stage('network.lan.ipaddr', '192.168.88.5');
    engine.commit('network');
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.status).toBe('connected');
    expect(engine.ping('192.168.1.200')).toContain('100% packet loss');
    expect(engine.startTest()).toContain('NO-IP-ROUTE');
    const bypass = make();
    bypass.state.network.bypass = true;
    bypass.setAttenuation(90);
    const before = bypass.state.network.wifiBytes;
    expect(bypass.ping('192.168.1.200')).toContain('0% packet loss');
    expect(bypass.iperf(['-c', '192.168.1.200', '-p', '9002', '-R'])).toContain('Ethernet bypass');
    expect(bypass.state.network.wifiBytes).toBe(before);
    expect(bypass.state.network.ethernetBytes).toBeGreaterThan(0);
    bypass.setAttenuation(0);
    bypass.tick(5);
    expect(bypass.startTest()).toContain('PATH-BYPASS');
  });

  it('checks server listener and derives iperf direction from client location and reverse flag', () => {
    const engine = make();
    expect(engine.iperf(['-c', '192.168.1.200'])).toContain('Connection refused');
    expect(engine.iperf(['-c', '192.168.1.200', '-p', '9002'])).toContain('Wireless direction: UL');
    expect(engine.iperf(['-c', '192.168.1.200', '-p', '9002', '-R'])).toContain(
      'Wireless direction: DL',
    );
    expect(engine.iperf(['-s', '-p', '9002'])).toContain('Server listening');
    expect(engine.iperf(['-c', '192.168.1.5', '-p', '9002'], 'windows')).toContain(
      'Wireless direction: DL',
    );
    expect(engine.iperf(['-c', '192.168.1.5', '-p', '9002', '-R'], 'windows')).toContain(
      'Wireless direction: UL',
    );
    engine.state.network.serverRunning = false;
    expect(engine.startTest()).toContain('SERVER-UNREACHABLE');
  });

  it('honors UDP offered load and preserves one-shot terminal clock semantics', () => {
    const engine = make();
    const before = engine.state.clock;
    const output = engine.iperf([
      '-c',
      '192.168.1.200',
      '-p',
      '9002',
      '-u',
      '-b',
      '100M',
      '-t',
      '3',
    ]);
    expect(output).toContain('100 Mbits/sec');
    expect(output).toContain('Lost/Total Datagrams');
    expect(engine.state.clock).toBe(before);
    expect(engine.state.network.wifiBytes).toBe(37_500_000);
  });

  it('restores complete workspace evidence but interrupts a previously running sweep', () => {
    const engine = make();
    engine.startTest({ duration: 1 });
    engine.tick();
    const restored = new LabEngine(engine.exportState());
    expect(restored.state.ap).toEqual(engine.state.ap);
    expect(restored.state.config).toEqual(engine.state.config);
    expect(restored.state.attenuation.db).toBe(engine.state.attenuation.db);
    expect(restored.state.msp.runs[0].points).toEqual(engine.state.msp.runs[0].points);
    expect(restored.state.msp.status).toBe('interrupted');
    expect(restored.state.msp.runs[0].error).toContain('SESSION-RESTORED');
    expect(new LabEngine('broken JSON').state.sta.status).toBe('connected');
  });

  it('applies recreated generic STA sections and deletion of the original APCLI', () => {
    const engine = make();
    for (const key of Object.keys(engine.state.config.committed).filter((key) =>
      key.startsWith('wireless.stamld0'),
    ))
      engine.stage(key, '__DELETE__');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.reason).toContain('STA-DISABLED');
    const values = {
      mode: 'sta',
      ifname: 'stamld0',
      device: 'MT7999_1_2',
      ssid: 'BN68',
      encryption: 'sae',
      ieee80211w: '2',
      key: 'qa-lab-2026',
    };
    for (const [key, value] of Object.entries(values))
      engine.stage(`wireless.cfg0001.${key}`, value);
    engine.stage('wireless.cfg0001', 'wifi-iface');
    engine.commit();
    engine.restart();
    engine.tick(6);
    expect(engine.state.sta.status).toBe('connected');
  });
});
