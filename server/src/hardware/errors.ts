/** Errors shared by every driver, transport and the controller. */

export class DeviceTimeoutError extends Error {
  constructor(message = 'device did not reply in time') {
    super(message);
    this.name = 'DeviceTimeoutError';
  }
}

export class DeviceDisconnectedError extends Error {
  constructor(message = 'device is not connected') {
    super(message);
    this.name = 'DeviceDisconnectedError';
  }
}

export class DeviceProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceProtocolError';
  }
}

export class DeviceBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceBusyError';
  }
}

/** Thrown by the controller when the device cannot take commands: offline, in error, or stopped. */
export class DeviceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceUnavailableError';
  }
}
