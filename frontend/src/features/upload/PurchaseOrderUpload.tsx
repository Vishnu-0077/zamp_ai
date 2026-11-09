import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi, systemApi } from '@/api/endpoints';
import { qk } from '@/api/queryKeys';
import type { PurchaseOrderUploadResult } from '@/api/types';
import { Alert, Badge, Card, DataTable, ErrorMessage } from '@/components';
import { ReviewerNameField } from '@/features/cases/components/ReviewerNameField';
import { isValidName, useReviewerName } from '@/lib/reviewerName';

const MAX_CSV = 1024 * 1024;

const EMPTY = {
  number: '',
  vendor_id: '',
  currency: '',
  amount: '',
  received_amount: '',
  previously_invoiced: '',
  tolerance_percent: '',
  issue_date: '',
};
type FormState = typeof EMPTY;

const COLUMNS: [string, string, string][] = [
  ['number', 'Yes', 'PO number, e.g. PO-26050. Must be new'],
  ['vendor_id', 'Yes', 'Vendor ID from Reference data → Vendors, e.g. V001'],
  ['currency', 'No', '3-letter code, e.g. USD. Blank uses the vendor’s currency'],
  ['amount', 'Yes', 'Total PO value, e.g. 1500.00'],
  ['received_amount', 'Yes', 'Value of goods/services received so far. Same as amount if all received'],
  ['previously_invoiced', 'No', 'Already invoiced outside this system. Default 0'],
  ['tolerance_percent', 'No', '0–100. Default 0'],
  ['issue_date', 'Yes', 'YYYY-MM-DD, e.g. 2026-11-01'],
];

/** Problems from a result, as one list of "Row n: message" lines. */
function rowErrors(result: PurchaseOrderUploadResult, label: (row: number) => string) {
  return result.rows.flatMap((r) => r.errors.map((e) => `${label(r.row)}${e}`));
}

/** Add purchase orders by hand (form) or in bulk (CSV). A person enters every value; no AI is involved. */
export function PurchaseOrderUpload() {
  const reviewer = useReviewerName();
  const nameOk = isValidName(reviewer);
  const client = useQueryClient();
  const refs = useQuery({ queryKey: qk.references, queryFn: systemApi.references });
  const vendors = refs.data?.vendors ?? [];

  const refresh = () => client.invalidateQueries({ queryKey: qk.references });

  // ---- form
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formBusy, setFormBusy] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [formError, setFormError] = useState<unknown>(null);
  const [added, setAdded] = useState<string | null>(null);
  const set = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  function pickVendor(id: string) {
    const vendor = vendors.find((v) => v.id === id);
    setForm((f) => ({ ...f, vendor_id: id, currency: vendor?.currency ?? f.currency }));
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormErrors([]);
    setFormError(null);
    setAdded(null);
    try {
      const result = await purchaseOrdersApi.add({ reviewer: reviewer.trim(), items: [form] });
      if (result.saved) {
        setAdded(form.number.trim());
        setForm(EMPTY);
        refresh();
      } else {
        setFormErrors(rowErrors(result, () => ''));
      }
    } catch (err) {
      setFormError(err);
    } finally {
      setFormBusy(false);
    }
  }

  // ---- CSV
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PurchaseOrderUploadResult | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<unknown>(null);
  const [csvSaved, setCsvSaved] = useState<number | null>(null);

  async function chooseCsv(files: FileList | null) {
    const chosen = files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setCheck(null);
    setCsvError(null);
    setCsvSaved(null);
    if (!chosen.name.toLowerCase().endsWith('.csv')) {
      setCsvError(new Error('Choose a .csv file. In Excel, use “Save as → CSV UTF-8”.'));
      return;
    }
    if (chosen.size > MAX_CSV) {
      setCsvError(new Error('The CSV file is larger than 1 MiB.'));
      return;
    }
    setCsvBusy(true);
    try {
      setCheck(await purchaseOrdersApi.importCsv(chosen, reviewer.trim(), true));
    } catch (err) {
      setCsvError(err);
    } finally {
      setCsvBusy(false);
    }
  }

  async function saveCsv() {
    if (!file) return;
    setCsvBusy(true);
    setCsvError(null);
    try {
      const result = await purchaseOrdersApi.importCsv(file, reviewer.trim());
      if (result.saved) {
        setCsvSaved(result.added);
        setCheck(null);
        setFile(null);
        refresh();
      } else {
        setCheck(result); // something changed since the check, e.g. a number was taken meanwhile
      }
    } catch (err) {
      setCsvError(err);
    } finally {
      setCsvBusy(false);
    }
  }

  const field = (key: keyof FormState, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <label className="field">
      {label}
      <input value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} />
      {hint && <span className="small muted" style={{ fontWeight: 400 }}>{hint}</span>}
    </label>
  );

  return (
    <>
      <Alert tone="info" title="How uploaded POs are used">
        New invoices are checked against these POs straight away, just like the built-in ones. They appear under{' '}
        <Link to="/references">Reference data → Purchase orders</Link> marked <em>Uploaded</em>.{' '}
        <strong style={{ display: 'inline' }}>Refresh &amp; start fresh</strong> and restarting the backend remove them.
      </Alert>

      <Card title="Your name">
        <ReviewerNameField />
        {!nameOk && <p className="small muted">Enter your name to add purchase orders. It is saved with each PO.</p>}
      </Card>

      {refs.error && <ErrorMessage error={refs.error} title="Could not load vendors" />}

      <Card title="Add one purchase order">
        <form onSubmit={submitForm} className="stack">
          <div className="grid grid-2">
            {field('number', 'PO number', { required: true, maxLength: 64, placeholder: 'PO-26050' })}
            <label className="field">
              Vendor
              <select value={form.vendor_id} onChange={(e) => pickVendor(e.target.value)} required>
                <option value="">Choose a vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.id}){v.approved ? '' : ' · not approved'}
                  </option>
                ))}
              </select>
            </label>
            {field('amount', 'PO amount', { required: true, inputMode: 'decimal', placeholder: '1500.00' })}
            {field('currency', 'Currency', { maxLength: 3, placeholder: 'USD', style: { textTransform: 'uppercase' } },
              'Filled in from the vendor; change it if this PO uses another currency.')}
            {field('received_amount', 'Received amount', { required: true, inputMode: 'decimal', placeholder: '1500.00' },
              'Value of goods or services received so far. Use the PO amount if everything has arrived.')}
            {field('issue_date', 'Issue date', { required: true, type: 'date' })}
            {field('previously_invoiced', 'Previously invoiced (optional)', { inputMode: 'decimal', placeholder: '0' },
              'Amount already invoiced against this PO outside this system.')}
            {field('tolerance_percent', 'Tolerance % (optional)', { inputMode: 'decimal', placeholder: '0' })}
          </div>
          {formErrors.length > 0 && (
            <Alert tone="danger" title="The PO was not saved">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{formErrors.map((m) => <li key={m}>{m}</li>)}</ul>
            </Alert>
          )}
          <ErrorMessage error={formError} title="Could not save the PO" />
          {added && <Alert tone="ok" title={`${added} added`}>New invoices that quote this PO are now matched against it.</Alert>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={!nameOk || formBusy}>
              {formBusy ? 'Saving…' : 'Save purchase order'}
            </button>
            <button className="btn" type="button" onClick={() => { setForm(EMPTY); setFormErrors([]); setAdded(null); }}>
              Clear
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="Upload many purchase orders (CSV)"
        actions={<a className="btn btn-sm" href={purchaseOrdersApi.templateUrl()} download>Download template</a>}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Fill in the template in Excel or Google Sheets, one PO per row, and save it as <strong>CSV UTF-8</strong>. The file
          is checked first; nothing is saved until you confirm, and only when every row is correct.
        </p>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          aria-disabled={!nameOk}
          style={nameOk ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
          onClick={() => nameOk && input.current?.click()}
          onKeyDown={(e) => nameOk && (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (nameOk) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (nameOk) chooseCsv(e.dataTransfer.files); }}
        >
          <strong>{nameOk ? 'Drop a CSV file here or click to choose' : 'Enter your name above first'}</strong>
          <div className="small muted">.csv up to 1 MiB · up to 1000 purchase orders</div>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => { chooseCsv(e.target.files); e.target.value = ''; }}
          />
        </div>

        {csvBusy && <p className="muted">Checking {file?.name}…</p>}
        <ErrorMessage error={csvError} title="Could not read the CSV" />
        {csvSaved !== null && (
          <Alert tone="ok" title={`${csvSaved} purchase order${csvSaved === 1 ? '' : 's'} added`}>
            They are now used to match new invoices.
          </Alert>
        )}

        {check && file && (
          <div className="stack" style={{ marginTop: 16 }}>
            {check.valid ? (
              <Alert tone="ok" title={`${check.rows.length} purchase order${check.rows.length === 1 ? '' : 's'} ready to add`}>
                Every row in <strong style={{ display: 'inline' }}>{file.name}</strong> passed the checks.
              </Alert>
            ) : (
              <Alert tone="danger" title="Nothing was saved">
                {check.rows.filter((r) => r.errors.length).length} row(s) need fixing. Correct them in your file and upload it
                again. Row numbers match your spreadsheet.
              </Alert>
            )}
            <DataTable
              rows={check.rows}
              rowKey={(r) => String(r.row)}
              columns={[
                { key: 'row', header: 'Row', numeric: true, render: (r) => r.row },
                { key: 'number', header: 'PO', render: (r) => (r.number ? <code>{r.number}</code> : '—') },
                {
                  key: 'result',
                  header: 'Check',
                  render: (r) =>
                    r.errors.length === 0 ? <Badge tone="ok">OK</Badge> : (
                      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--danger)' }}>{r.errors.map((m) => <li key={m}>{m}</li>)}</ul>
                    ),
                },
              ]}
            />
            <div className="row">
              {check.valid && (
                <button className="btn btn-primary" type="button" onClick={saveCsv} disabled={csvBusy || !nameOk}>
                  {csvBusy ? 'Saving…' : `Save ${check.rows.length} purchase order${check.rows.length === 1 ? '' : 's'}`}
                </button>
              )}
              <button className="btn" type="button" onClick={() => { setCheck(null); setFile(null); }}>Cancel</button>
            </div>
          </div>
        )}

        <details style={{ marginTop: 16 }}>
          <summary className="small"><strong>CSV columns</strong></summary>
          <DataTable
            rows={COLUMNS}
            rowKey={(c) => c[0]}
            columns={[
              { key: 'col', header: 'Column', render: (c) => <code>{c[0]}</code> },
              { key: 'req', header: 'Required', render: (c) => c[1] },
              { key: 'what', header: 'What to enter', render: (c) => c[2] },
            ]}
          />
        </details>
      </Card>
    </>
  );
}
