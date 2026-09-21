import { describe, it, expect } from 'vitest';
import { ApprovalBroker, nextApprovalId } from '../src/permission';

describe('ApprovalBroker', () => {
  it('resolves pending request via subscribe + resolve', async () => {
    const broker = new ApprovalBroker();
    const seen: string[] = [];
    const unsub = broker.subscribe((req) => {
      seen.push(req.approvalId);
    });
    const p = broker.request({
      approvalId: nextApprovalId(),
      toolName: 'file_write',
      params: { path: 'a.txt' },
      label: 'file_write a.txt',
      mode: 'suggest',
    });
    expect(seen).toHaveLength(1);
    expect(broker.pendingCount).toBe(1);
    expect(broker.resolve(seen[0]!, 'allow')).toBe(true);
    await expect(p).resolves.toBe('allow');
    expect(broker.pendingCount).toBe(0);
    unsub();
  });

  it('unknown id returns false', () => {
    const broker = new ApprovalBroker();
    expect(broker.resolve('nope', 'deny')).toBe(false);
  });
});
