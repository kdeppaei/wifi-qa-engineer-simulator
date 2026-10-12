import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createPeakDocument, blankPeakValues, rowKey } from './model';
import { makePeakWorkbook, peakHeaderTextColor } from './workbook';

const packageOf = (blank = false) => {
  const doc = createPeakDocument();
  doc.values[rowKey(doc.groups[0].id, 'UL')] = {
    ...blankPeakValues(),
    criteria: '>= 8%',
    su: '1200.2512',
    mu: '0',
    gain: '-5',
  };
  doc.values[rowKey(doc.groups[0].id, 'DL')] = { ...blankPeakValues(), su: '100', mu: '200' };
  return { doc, files: unzipSync(makePeakWorkbook(doc, blank)) };
};
describe('native editable manual Peak results table', () => {
  it('exports numeric metadata, measurements, real zero and manually entered Gain without formulas', () => {
    const { files } = packageOf();
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toMatch(/r="B7"[^>]*><x:v>37<\/x:v>/);
    expect(sheet).toMatch(/r="E7"[^>]*><x:v>1200.2512<\/x:v>/);
    expect(sheet).toMatch(/r="F7"[^>]*><x:v>0<\/x:v>/);
    expect(sheet).toMatch(/r="G7"[^>]*><x:v>-5<\/x:v>/);
    expect(sheet).toMatch(/r="G8"[^>]*\/>/);
    expect(sheet).not.toMatch(/<x:f\b/);
    expect(sheet).not.toContain('sheetProtection');
    expect(strFromU8(files['xl/tables/table1.xml'])).toContain('ref="A6:G8"');
    expect(Object.keys(files).some((path) => /\/charts\/|\/media\//.test(path))).toBe(false);
  });
  it('exports literal manual entries exactly, including formulas as text', () => {
    const { doc } = packageOf();
    doc.values[rowKey(doc.groups[0].id, 'UL')].gain = '=MU/SU <test> & literal';
    const sheet = strFromU8(unzipSync(makePeakWorkbook(doc))['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('=MU/SU &lt;test&gt; &amp; literal');
    expect(sheet).not.toMatch(/<x:f\b/);
  });
  it('keeps group rows and headers but clears all measurements in a blank export without mutating input', () => {
    const { doc, files } = packageOf(true);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('6G_UHR320');
    expect(sheet).toContain('UL');
    for (const address of ['D7', 'E7', 'F7', 'G7', 'D8', 'E8', 'F8', 'G8'])
      expect(sheet).toMatch(new RegExp(`r="${address}"[^>]*\\/>`));
    expect(doc.values[rowKey(doc.groups[0].id, 'UL')].su).toBe('1200.2512');
  });
  it('exports custom labels, ordering, hidden fields and manual extra columns', () => {
    const { doc } = packageOf();
    doc.columns[4].label = 'SU rate';
    doc.columns[3].visible = false;
    doc.columns.unshift({
      id: 'remarks',
      key: 'remarks',
      label: 'Notes & version',
      type: 'text',
      visible: true,
      width: 25,
    });
    doc.values[rowKey(doc.groups[0].id, 'UL')].extra.remarks = 'DUT rev A';
    const files = unzipSync(makePeakWorkbook(doc));
    const table = strFromU8(files['xl/tables/table1.xml']);
    expect(table).toContain('name="Notes &amp; version"');
    expect(table).toContain('name="SU rate"');
    expect(table).not.toContain('name="Gain Criteria"');
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('DUT rev A');
    expect(table).toContain('ref="A6:G8"');
  });
  it('applies header color, legible text, precision, widths and stripe preference without rounding raw values', () => {
    const { doc } = packageOf();
    doc.settings.headerColor = '#FFFF00';
    doc.settings.fontSize = 14;
    doc.settings.decimals = 3;
    doc.settings.bandedRows = false;
    doc.columns[0].width = 30;
    const files = unzipSync(makePeakWorkbook(doc));
    const styles = strFromU8(files['xl/styles.xml']);
    expect(styles).toContain('FFFFFF00');
    expect(styles).toContain('FF172033');
    expect(styles).toContain('formatCode="0.000"');
    expect(styles).toContain('<x:sz val="14"');
    expect(strFromU8(files['xl/tables/table1.xml'])).toContain('showRowStripes="0"');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('width="30"');
    expect(sheet).toContain('<x:v>1200.2512</x:v>');
    expect(peakHeaderTextColor('#FFFFFF')).toBe('#172033');
    expect(peakHeaderTextColor('#1D4ED8')).toBe('#FFFFFF');
  });
  it('resizes the native table and repeated metadata for optional BI and more groups', () => {
    const { doc } = packageOf();
    doc.groups[0].directions.push('BI');
    doc.groups.push({ id: 'second', bandConfig: '2G_UHR40', channel: '6', directions: ['DL'] });
    const files = unzipSync(makePeakWorkbook(doc));
    expect(strFromU8(files['xl/tables/table1.xml'])).toContain('ref="A6:G10"');
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('2G_UHR40');
    expect(sheet).toMatch(/r="B10"[^>]*><x:v>6<\/x:v>/);
    expect(sheet).toContain('BI');
  });
  it('blocks invalid selected values and duplicate native table names before creating a file', () => {
    const { doc } = packageOf();
    doc.values[rowKey(doc.groups[0].id, 'UL')].su = 'bad';
    expect(() => makePeakWorkbook(doc)).toThrow('SU');
    doc.values[rowKey(doc.groups[0].id, 'UL')].su = '100';
    doc.columns[1].label = 'band/config';
    expect(() => makePeakWorkbook(doc)).toThrow('重複');
  });
});
