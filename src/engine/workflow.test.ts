import { describe, expect, it } from 'vitest';
import { LabEngine, type Band } from './lab';
import { TerminalSession } from './terminal';
import {
  commandShortcuts,
  evaluateWorkflowStep,
  resolveCommand,
  workflows,
  type WorkflowStep,
} from './workflow';

const flow = (id: string) => workflows.find((item) => item.id === id)!;
const step = (id: string) =>
  workflows.flatMap((item) => item.steps).find((item) => item.id === id)!;
const shortcut = (id: string) => commandShortcuts.find((item) => item.id === id)!;
function make(band: Band = '5') {
  const engine = new LabEngine();
  engine.reset(band);
  return {
    engine,
    linux: new TerminalSession(engine, 'linux'),
    windows: new TerminalSession(engine, 'windows'),
  };
}
function execute(current: WorkflowStep, context: ReturnType<typeof make>, edited?: string) {
  if (current.kind !== 'command') throw new Error('expected command step');
  const command = edited ?? resolveCommand(current, context.engine.state);
  const startedAt = context.engine.state.clock;
  const session = current.os === 'linux' ? context.linux : context.windows;
  const output = session.execute(command);
  return evaluateWorkflowStep(current, context.engine.state, {
    command,
    output,
    os: current.os,
    startedAt,
  });
}

describe('workflow definitions and actual supported commands', () => {
  it('exposes four independent workflows without mutating the lab when selected or resolved', () => {
    const { engine } = make('6');
    const before = engine.exportState();
    expect(workflows.map((item) => item.id)).toEqual([
      'connection-direction',
      'uci-bf-lifecycle',
      'migrate-5g',
      'rf-recovery',
      'rvr-bf-comparison',
    ]);
    for (const item of workflows)
      for (const current of item.steps) {
        expect(
          current.title && current.explanation && current.observe && current.expected,
        ).toBeTruthy();
        if (current.kind === 'command') resolveCommand(current, engine.state);
      }
    commandShortcuts.forEach((item) => resolveCommand(item, engine.state));
    expect(engine.exportState()).toBe(before);
  });

  it('chooses runtime and UCI radios independently during an unapplied migration', () => {
    const { engine } = make('6');
    expect(resolveCommand(shortcut('vt-bf-off'), engine.state)).toContain('MT7999_1_3');
    engine.stage('wireless.stamld0.device', 'MT7999_1_2');
    expect(resolveCommand(shortcut('vt-bf-config'), engine.state)).toContain('MT7999_1_2');
    expect(resolveCommand(shortcut('vt-bf-active-radio'), engine.state)).toContain('MT7999_1_3');
    engine.commit();
    engine.restart();
    expect(resolveCommand(shortcut('vt-bf-off'), engine.state)).toContain('MT7999_1_2');
    expect(resolveCommand(shortcut('cmd-ip'), engine.state)).toBe('ipconfig');
  });

  it('all shortcut commands use the existing terminal, with explicit listener prerequisites', () => {
    const context = make();
    context.linux.execute('iperf3 -s -p 5201');
    for (const item of commandShortcuts) {
      if (
        [
          'vt-restart',
          'vt-reboot',
          'vt-scan',
          'vt-log',
          'vt-commit',
          'vt-bf-off',
          'vt-bf-on',
        ].includes(item.id)
      )
        continue;
      const output = (item.os === 'linux' ? context.linux : context.windows).execute(
        resolveCommand(item, context.engine.state),
      );
      expect(output, item.id).not.toMatch(
        /not found|not recognized|Unknown command|unsupported operation|parameter error/,
      );
    }
  });
});

describe('output and state feedback', () => {
  it('completes connection and direction basics from real Linux and Windows results', () => {
    const context = make();
    for (const current of flow('connection-direction').steps)
      expect(execute(current, context).status, current.id).toBe('success');
    expect(context.engine.state.network.wifiBytes).toBeGreaterThan(0);
  });

  it('fails wrong commands, echo spoof, missing server and wrong terminal location', () => {
    const context = make();
    expect(execute(step('connection-link'), context, 'echo "Connected to fake"').status).toBe(
      'failure',
    );
    expect(
      execute(step('connection-ping'), context, 'ping 192.168.1.5 #192.168.1.200').status,
    ).toBe('failure');
    context.engine.state.network.serverRunning = false;
    expect(execute(step('connection-ul'), context).status).toBe('failure');
    expect(
      evaluateWorkflowStep(step('connection-link'), context.engine.state, {
        command: 'iw dev stamld0 link',
        output: 'Connected to fake',
        os: 'windows',
      }).status,
    ).toBe('failure');
    context.engine.state.network.bypass = true;
    expect(execute(step('connection-ping'), context).status).toBe('failure');
  });

  it('quiet UCI mutations succeed from real postconditions and commit does not apply Runtime', () => {
    const context = make();
    expect(execute(step('bf-read'), context).status).toBe('success');
    expect(execute(step('bf-stage-off'), context).status).toBe('success');
    expect(context.engine.state.config.staged['wireless.MT7999_1_2.etxbfencond']).toBe('0');
    expect(context.engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('3');
    expect(execute(step('bf-read-pending'), context).status).toBe('success');
    expect(execute(step('bf-commit'), context).status).toBe('success');
    expect(context.engine.state.config.committed['wireless.MT7999_1_2.etxbfencond']).toBe('0');
    expect(context.engine.state.config.runtime['wireless.MT7999_1_2.etxbfencond']).toBe('3');
    expect(execute(step('bf-read-committed'), context).status).toBe('success');
    expect(execute(step('bf-restart'), context).status).toBe('success');
    expect(context.engine.state.sta.status).toBe('restarting');
  });

  it('does not treat empty output, a different radio or an unrelated query as proof of the selected mutation', () => {
    const context = make();
    expect(
      evaluateWorkflowStep(step('bf-stage-off'), context.engine.state, {
        command: 'uci set wireless.MT7999_1_2.etxbfencond=0',
        output: '',
        os: 'linux',
      }).status,
    ).toBe('failure');
    expect(
      execute(step('bf-stage-off'), context, 'uci set wireless.MT7999_1_3.etxbfencond=0').status,
    ).toBe('failure');
    expect(execute(step('bf-read'), context, 'uci get wireless.stamld0.disabled').status).toBe(
      'failure',
    );
    expect(
      evaluateWorkflowStep(step('bf-stage-off'), context.engine.state, {
        command: 'uci set wireless.MT7999_1_2.etxbfencond=0',
        output: '',
        os: 'linux',
        exitCode: 1,
      }).status,
    ).toBe('failure');
  });

  it('restart wait advances through scan and association, and rejects instant fabricated Connected', () => {
    const context = make();
    execute(step('bf-stage-off'), context);
    execute(step('bf-commit'), context);
    execute(step('bf-restart'), context);
    const attempt = { startedAt: context.engine.state.clock };
    expect(evaluateWorkflowStep(step('bf-wait'), context.engine.state, attempt).status).toBe(
      'waiting',
    );
    context.engine.state.sta.status = 'connected';
    expect(evaluateWorkflowStep(step('bf-wait'), context.engine.state, attempt).status).toBe(
      'waiting',
    );
    context.engine.state.sta.status = 'restarting';
    context.engine.tick(2);
    expect(context.engine.state.sta.status).toBe('scanning');
    expect(evaluateWorkflowStep(step('bf-wait'), context.engine.state, attempt).status).toBe(
      'waiting',
    );
    context.engine.tick(2);
    expect(context.engine.state.sta.status).toBe('associating');
    expect(evaluateWorkflowStep(step('bf-wait'), context.engine.state, attempt).status).toBe(
      'waiting',
    );
    context.engine.tick(2);
    expect(evaluateWorkflowStep(step('bf-wait'), context.engine.state, attempt).status).toBe(
      'success',
    );
  });

  it('wrong SSID remains an explicit unresolved wait instead of passing a timer', () => {
    const context = make();
    execute(step('bf-stage-off'), context);
    execute(step('bf-commit'), context);
    context.engine.updateAP({ ssid: 'OTHER' });
    execute(step('bf-restart'), context);
    context.engine.tick(20);
    const result = evaluateWorkflowStep(step('bf-wait'), context.engine.state, { startedAt: 0 });
    expect(result.status).toBe('waiting');
    expect(result.message).toMatch(/尚未連線|目前 scanning/);
    expect(result.hint).toContain('SSID');
  });

  it('handles wpa_cli mode errors with a useful shell-mode hint', () => {
    const context = make();
    context.linux.execute('wpa_cli -i stamld0');
    const result = execute(step('bf-stage-off'), context);
    expect(result.status).toBe('failure');
    expect(result.hint).toContain('quit');
    context.linux.execute('quit');
    expect(execute(step('bf-stage-off'), context).status).toBe('success');
  });

  it('migrates APCLI from 6G to 5G using genuine supported delete/add_list/commit/restart commands', () => {
    const context = make('6');
    context.engine.updateAP({ band: '5', ssid: 'BN68', channel: 36 });
    expect(
      evaluateWorkflowStep(step('migration-ap'), context.engine.state, {
        action: 'configure-ap-5g',
      }).status,
    ).toBe('success');
    for (const id of [
      'migration-read',
      'migration-ssid',
      'migration-device',
      'migration-commit',
      'migration-restart',
    ])
      expect(execute(step(id), context).status, id).toBe('success');
    expect(evaluateWorkflowStep(step('migration-wait'), context.engine.state).status).toBe(
      'waiting',
    );
    context.engine.tick(6);
    expect(evaluateWorkflowStep(step('migration-wait'), context.engine.state).status).toBe(
      'success',
    );
    expect(execute(step('migration-link'), context).status).toBe('success');
    expect(execute(step('migration-ping'), context).status).toBe('success');
    expect(context.engine.state.sta.freq).toBe(5180);
  });

  it('permits explicit state-check skips when migration Runtime is already correct, but not when unapplied', () => {
    const { engine } = make();
    for (const id of [
      'migration-ssid',
      'migration-device',
      'migration-commit',
      'migration-restart',
    ])
      expect(evaluateWorkflowStep(step(id), engine.state).status, id).toBe('success');
    const six = make('6').engine;
    six.updateAP({ band: '5', ssid: 'BN68', channel: 36 });
    six.stage('wireless.stamld0.device', 'MT7999_1_2');
    six.stage('wireless.stamld0.ssid', 'BN68');
    six.commit();
    expect(evaluateWorkflowStep(step('migration-restart'), six.state).status).toBe('ready');
    expect(evaluateWorkflowStep(step('migration-wait'), six.state).status).toBe('waiting');
  });

  it('requires an explicit RF fault action, real negative evidence, restoration and progressive reconnection', () => {
    const context = make();
    const before = context.engine.exportState();
    expect(evaluateWorkflowStep(step('fault-setup'), context.engine.state).status).toBe('ready');
    expect(context.engine.exportState()).toBe(before);
    context.engine.reset('5');
    context.engine.stage('wireless.MT7999_1_2.etxbfencond', '0');
    context.engine.commit();
    context.engine.setAttenuation(90);
    context.engine.restart(true);
    expect(
      evaluateWorkflowStep(step('fault-setup'), context.engine.state, { action: 'setup-rf-fault' })
        .status,
    ).toBe('success');
    expect(
      evaluateWorkflowStep(step('fault-wait'), context.engine.state, { startedAt: 0 }).status,
    ).toBe('waiting');
    context.engine.tick(9);
    expect(
      evaluateWorkflowStep(step('fault-wait'), context.engine.state, { startedAt: 0 }).status,
    ).toBe('success');
    for (const id of ['fault-link', 'fault-config', 'fault-scan', 'fault-log'])
      expect(execute(step(id), context).status, id).toBe('success');
    context.engine.setAttenuation(context.engine.state.attenuation.start);
    expect(
      evaluateWorkflowStep(step('fault-restore'), context.engine.state, {
        action: 'restore-attenuation',
      }).status,
    ).toBe('success');
    expect(
      evaluateWorkflowStep(step('fault-recovery-wait'), context.engine.state, { startedAt: 9 })
        .status,
    ).toBe('waiting');
    context.engine.tick(5);
    expect(
      evaluateWorkflowStep(step('fault-recovery-wait'), context.engine.state, { startedAt: 9 })
        .status,
    ).toBe('success');
    expect(execute(step('fault-recovered-link'), context).status).toBe('success');
    expect(execute(step('fault-recovered-ping'), context).status).toBe('success');
    expect(
      context.engine.state.logs.some((entry) => entry.message.includes('NETWORK-NOT-FOUND')),
    ).toBe(true);
  });
});
