import { describe, it, expect } from 'vitest';
import { AgentRuntime } from '../src/runtime';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AgentRuntime session serialization', () => {
  it('same sessionId runs jobs sequentially', async () => {
    const rt = new AgentRuntime({
      mode: 'build',
      provider: { model: 'test' },
      workspaceRoot: process.cwd(),
      enableBash: false,
      toolProtocol: 'xml',
    });
    const seen: string[] = [];
    const enqueue = (rt as unknown as {
      enqueueSession: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    }).enqueueSession.bind(rt);

    await Promise.all([
      enqueue('s1', async () => {
        seen.push('1-start');
        await sleep(40);
        seen.push('1-end');
      }),
      enqueue('s1', async () => {
        seen.push('2-start');
        await sleep(5);
        seen.push('2-end');
      }),
    ]);

    expect(seen).toEqual(['1-start', '1-end', '2-start', '2-end']);
    await rt.dispose();
  });

  it('different sessions may run in parallel', async () => {
    const rt = new AgentRuntime({
      mode: 'build',
      provider: { model: 'test' },
      workspaceRoot: process.cwd(),
      enableBash: false,
      toolProtocol: 'xml',
    });
    const seen: string[] = [];
    const enqueue = (rt as unknown as {
      enqueueSession: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    }).enqueueSession.bind(rt);

    await Promise.all([
      enqueue('a', async () => {
        seen.push('a-start');
        await sleep(40);
        seen.push('a-end');
      }),
      enqueue('b', async () => {
        seen.push('b-start');
        await sleep(10);
        seen.push('b-end');
      }),
    ]);

    expect(seen.indexOf('b-start')).toBeLessThan(seen.indexOf('a-end'));
    await rt.dispose();
  });

  it('failure does not block subsequent jobs on same session', async () => {
    const rt = new AgentRuntime({
      mode: 'build',
      provider: { model: 'test' },
      workspaceRoot: process.cwd(),
      enableBash: false,
      toolProtocol: 'xml',
    });
    const enqueue = (rt as unknown as {
      enqueueSession: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    }).enqueueSession.bind(rt);

    const seen: string[] = [];
    const p1 = enqueue('s', async () => {
      throw new Error('boom');
    });
    const p2 = enqueue('s', async () => {
      seen.push('second-ran');
      return 'ok';
    });
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
    expect(seen).toEqual(['second-ran']);
    await rt.dispose();
  });
});
