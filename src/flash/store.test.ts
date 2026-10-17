import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fullFqbn } from '../boards/types';
import { getBoard } from '../boards/registry';
import { sketchRequest } from '../compile/client';
import { useCompileStore } from '../compile/store';
import type { CompileRequest, CompileResult } from '../compile/types';
import { fakeTransport, type FakeTransport } from '../test/fake-transport';
import { useTransportStore } from '../transport/store';
import { reopenTransport, uploadErrorKey, useFlashStore } from './store';
import { FlashError, type Flasher, type FlashHooks } from './types';

// The store with a fake flasher (no esptool-js/avrgirl) and a fake transport that records
// open/close order.
const h = vi.hoisted(() => ({
  flash: vi.fn<Flasher['flash']>(),
  supportsCancel: true,
}));

vi.mock('./select', () => ({
  selectFlasher: () => ({
    get supportsCancel() {
      return h.supportsCancel;
    },
    flash: h.flash,
  }),
}));

const CODE = 'void setup() {}\nvoid loop() {}\n';
const BOARD_ID = 'nano-old';
const AVR: CompileResult = { kind: 'avr', hex: new Uint8Array([0x3a]), log: '' };

const initialFlash = useFlashStore.getState();
const initialCompile = useCompileStore.getState();
const initialTransport = useTransportStore.getState();

function request(code = CODE, boardId = BOARD_ID): CompileRequest {
  return sketchRequest(code, fullFqbn(getBoard(boardId)));
}

describe('flash store upload()', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    useFlashStore.setState(initialFlash, true);
    useCompileStore.setState(
      { ...initialCompile, status: 'ok', result: AVR, request: request() },
      true,
    );
    transport = fakeTransport();
    useTransportStore.setState(
      {
        ...initialTransport,
        status: 'connected',
        transport,
        disconnect: vi.fn(async () => {
          useTransportStore.setState({ status: 'disconnected', transport: null });
        }),
      },
      true,
    );
    h.supportsCancel = true;
    h.flash.mockReset().mockImplementation(async (_result, _board, t, hooks) => {
      transport.events.push(
        `flash (port open: ${t.isOpen}, isFlashing: ${String(useFlashStore.getState().isFlashing)})`,
      );
      hooks.onLog('flasher says hi');
      hooks.onProgress({ phase: 'write', percent: 40 });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the port before the flasher, reopens it after, and toggles isFlashing', async () => {
    const seen: boolean[] = [];
    const unsubscribe = useFlashStore.subscribe((state) => seen.push(state.isFlashing));
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    unsubscribe();

    expect(transport.events).toEqual([
      'close',
      'flash (port open: false, isFlashing: true)',
      'open 115200',
    ]);
    const [result, board] = h.flash.mock.calls[0]!;
    expect(result).toBe(AVR);
    expect(board.id).toBe(BOARD_ID);
    const state = useFlashStore.getState();
    expect(state).toMatchObject({ status: 'done', phase: 'done', percent: 100, error: null });
    expect(state.isFlashing).toBe(false);
    expect(state.log).toEqual(['flasher says hi']);
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
  });

  it('a failed flash still reopens the port and maps the code to a message', async () => {
    h.flash.mockRejectedValue(new FlashError('wrong-chip', 'found ESP32'));
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    const state = useFlashStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toEqual({ key: 'UI_UPLOAD_ERR_WRONG_CHIP', detail: 'found ESP32' });
    expect(state.log).toContain('found ESP32');
    expect(state.isFlashing).toBe(false);
    expect(transport.events.at(-1)).toBe('open 115200');
  });

  it('a non-FlashError throw is write-failed with its message', async () => {
    h.flash.mockRejectedValue(new TypeError('boom'));
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(useFlashStore.getState().error).toEqual({ key: 'UI_UPLOAD_ERR_WRITE', detail: 'boom' });
  });

  it('when the port does not come back, the transport store is told it is gone', async () => {
    vi.useFakeTimers();
    transport.open.mockRejectedValue(new Error('Failed to open serial port.'));
    const done = useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    await vi.runAllTimersAsync();
    await done;
    expect(transport.open).toHaveBeenCalledTimes(5);
    expect(useTransportStore.getState().disconnect).toHaveBeenCalled();
    expect(useTransportStore.getState().status).toBe('disconnected');
    expect(useFlashStore.getState().isFlashing).toBe(false);
    expect(useFlashStore.getState().log.at(-1)).toMatch(/did not reopen/);
  });

  it('stays locked until the port is back: a second click during the reopen is ignored', async () => {
    vi.useFakeTimers();
    transport.open.mockRejectedValueOnce(new Error('busy'));
    const first = useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    await vi.waitFor(() => expect(transport.open).toHaveBeenCalledTimes(1));
    // Flash finished, first reopen failed, waiting before the retry.
    expect(useFlashStore.getState()).toMatchObject({ status: 'flashing', isFlashing: true });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    await vi.runAllTimersAsync();
    await first;
    expect(h.flash).toHaveBeenCalledTimes(1);
    expect(useFlashStore.getState()).toMatchObject({ status: 'done', isFlashing: false });
  });

  it('a disconnect during the upload is respected: the forgotten port stays closed', async () => {
    h.flash.mockImplementation(async () => {
      await useTransportStore.getState().disconnect();
    });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(transport.open).not.toHaveBeenCalled();
    expect(transport.isOpen).toBe(false);
    expect(useFlashStore.getState().isFlashing).toBe(false);
  });

  it('a port reconnected elsewhere while reopening is closed again', async () => {
    transport.open.mockImplementation(async () => {
      transport.isOpen = true;
      useTransportStore.setState({ transport: fakeTransport() });
    });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(transport.open).toHaveBeenCalledTimes(1);
    expect(transport.events.at(-1)).toBe('close');
    expect(transport.isOpen).toBe(false);
  });

  it('a compile started by hand clears the previous upload output', async () => {
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(useFlashStore.getState().log).not.toEqual([]);
    useCompileStore.setState({ status: 'compiling' });
    expect(useFlashStore.getState()).toMatchObject({ status: 'idle', log: [], error: null });
  });

  it('recompiles first when the sketch changed since the last compile', async () => {
    const run = vi.fn(async (req: CompileRequest) => {
      useCompileStore.setState({ status: 'ok', result: AVR, request: req });
    });
    useCompileStore.setState({ run });
    await useFlashStore.getState().upload({ code: `${CODE}// changed\n`, boardId: BOARD_ID });
    expect(run).toHaveBeenCalledWith(request(`${CODE}// changed\n`));
    expect(h.flash).toHaveBeenCalledTimes(1);
    expect(useFlashStore.getState().status).toBe('done');
  });

  it('does not flash when that compile fails', async () => {
    useCompileStore.setState({
      result: null,
      request: null,
      run: vi.fn(async () => {
        useCompileStore.setState({ status: 'error', result: null });
      }),
    });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(h.flash).not.toHaveBeenCalled();
    expect(useFlashStore.getState().error).toEqual({ key: 'UI_UPLOAD_ERR_COMPILE' });
    expect(transport.events).toEqual([]);
  });

  it('without a connected board it asks to connect and never touches a port', async () => {
    useTransportStore.setState({ status: 'disconnected', transport: null });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(h.flash).not.toHaveBeenCalled();
    expect(useFlashStore.getState().error).toEqual({ key: 'UI_UPLOAD_ERR_NO_PORT' });
  });

  it('cancel() aborts the signal the flasher got', async () => {
    let hooks: FlashHooks | undefined;
    h.flash.mockImplementation(async (_r, _b, _t, given) => {
      hooks = given;
      useFlashStore.getState().cancel();
      if (given.signal?.aborted) throw new FlashError('cancelled');
    });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(hooks?.signal?.aborted).toBe(true);
    expect(useFlashStore.getState().error?.key).toBe('UI_UPLOAD_ERR_CANCELLED');
  });

  it('canCancel follows the flasher while flashing', async () => {
    h.supportsCancel = false;
    let during: boolean | undefined;
    h.flash.mockImplementation(async () => {
      during = useFlashStore.getState().canCancel;
    });
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    expect(during).toBe(false);
    expect(useFlashStore.getState().canCancel).toBe(false);
  });

  it('a second upload while one runs is ignored', async () => {
    let release: () => void = () => {};
    h.flash.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const first = useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    await vi.waitFor(() => expect(h.flash).toHaveBeenCalled());
    await useFlashStore.getState().upload({ code: CODE, boardId: BOARD_ID });
    release();
    await first;
    expect(h.flash).toHaveBeenCalledTimes(1);
  });
});

describe('uploadErrorKey', () => {
  it('gives the ESP sync failure the BOOT + RESET hint and the AVR one the board hint', () => {
    expect(uploadErrorKey('sync-failed', getBoard('esp32c3-supermini'))).toBe(
      'UI_UPLOAD_ERR_SYNC_ESP',
    );
    expect(uploadErrorKey('sync-failed', getBoard('uno'))).toBe('UI_UPLOAD_ERR_SYNC_AVR');
    expect(uploadErrorKey('transport', getBoard('uno'))).toBe('UI_UPLOAD_ERR_TRANSPORT');
  });
});

describe('reopenTransport', () => {
  it('retries until the port opens', async () => {
    const transport = fakeTransport();
    transport.isOpen = false;
    transport.open.mockRejectedValueOnce(new Error('busy')).mockImplementationOnce(async () => {
      transport.isOpen = true;
    });
    expect(await reopenTransport(transport, 3, 0)).toBe(true);
    expect(transport.open).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the port is already open', async () => {
    const transport = fakeTransport();
    expect(await reopenTransport(transport, 3, 0)).toBe(true);
    expect(transport.open).not.toHaveBeenCalled();
  });
});
