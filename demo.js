// Sample handover, loaded on first visit so the whole flow is visible without typing anything.
import { sourceFromEntry } from './handover.js';

export function demoSources() {
  return [
    { id: 'demo-notes', kind: 'notes', label: 'Notes, Priya', author: 'Priya', text:
`Priya here, handing over the billing sync project before my move to the platform team.
We decided to keep Postgres as the ledger store, not DynamoDB.
Priya owns the payment retry job until the cutover on Friday.
The retry job still needs tests for the backoff path.
Risk: the webhook receiver has no idempotency key, so a retry can double-charge a card.
Open: the invoice PDF export is not started yet.
Dana owns the invoice PDF export.
Open: the reconciliation report has no owner yet.
Rohit is responsible for the certificate renewal. The certificate expires on 20 Nov, and if it lapses the audit fails.` },
    { id: 'demo-issues', kind: 'issues', label: 'Issue export (CSV)', author: '', text:
`id,title,owner,status,updated
41,Payment retry job backoff,Ravi,in progress,2026-10-30
42,Invoice PDF export,,open,2026-10-28
43,Webhook idempotency key,Priya,blocked,2026-10-29
44,Ledger store migration,Priya,done,2026-10-20` },
    { id: 'demo-commits', kind: 'commits', label: 'Commit log', author: '', text:
`a1b2c3d Ravi 2026-10-31 retry job: add exponential backoff
e4f5a6b Priya 2026-10-27 WIP webhook idempotency, hotfix pending review` },
  ];
}

export { sourceFromEntry };
