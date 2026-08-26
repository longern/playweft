import { forwardRef, type RefObject, type SyntheticEvent } from "react";
import {
  PLAYWEFT_BRIDGE_VERSION,
  dispatchRpcMessage,
  type RpcHandlers,
} from "./json-rpc";

const GAME_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms";
const GAME_FRAME_ALLOW = "clipboard-read 'none'; clipboard-write 'none'";

interface GameFrameProps {
  src: string;
  title: string;
  loaded: boolean;
  onLoad?(event: SyntheticEvent<HTMLIFrameElement>): void;
}

const GameFrame = forwardRef<HTMLIFrameElement, GameFrameProps>(
  function GameFrame({ src, title, loaded, onLoad }, ref) {
    return (
      <iframe
        ref={ref}
        className={`game-frame${loaded ? " is-loaded" : ""}`}
        title={title}
        src={src}
        sandbox={GAME_FRAME_SANDBOX}
        allow={GAME_FRAME_ALLOW}
        onLoad={onLoad}
      />
    );
  },
);

export default GameFrame;

export function attachGameBridge({
  frame,
  origin,
  handlers,
  onBeforeConnect,
  onPortChange,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  origin: string;
  handlers: RpcHandlers;
  onBeforeConnect?(): void;
  onPortChange?(port: MessagePort | undefined): void;
}): () => void {
  let port: MessagePort | undefined;

  const closePort = () => {
    port?.close();
    port = undefined;
    onPortChange?.(undefined);
  };

  const onWindowMessage = (event: MessageEvent) => {
    if (
      event.origin !== origin ||
      event.source !== frame.current?.contentWindow ||
      event.data?.type !== "playweft:bridge-ready" ||
      event.data?.version !== PLAYWEFT_BRIDGE_VERSION
    )
      return;

    onBeforeConnect?.();
    closePort();
    const channel = new MessageChannel();
    port = channel.port1;
    onPortChange?.(port);
    channel.port1.onmessage = (event) => {
      void dispatchRpcMessage(channel.port1, event.data, handlers);
    };
    channel.port1.start();
    frame.current?.contentWindow?.postMessage(
      { type: "playweft:bridge", version: PLAYWEFT_BRIDGE_VERSION },
      origin,
      [channel.port2],
    );
  };

  window.addEventListener("message", onWindowMessage);
  return () => {
    window.removeEventListener("message", onWindowMessage);
    closePort();
  };
}
