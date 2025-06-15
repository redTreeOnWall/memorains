export interface EventBusEvent {
  route: string;
  message: unknown;
}

export interface EventBug<
  SEND extends EventBusEvent,
  RECEIVE extends EventBusEvent
> {
  send: (route: SEND["route"], message: SEND["message"]) => void;
  listen: (
    route: RECEIVE["route"],
    onMessage: (message: RECEIVE["message"]) => void
  ) => void;
}
