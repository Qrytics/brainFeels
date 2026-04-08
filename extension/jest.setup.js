// Extend jest-webextension-mock with chrome.alarms (not included in the
// version of jest-webextension-mock used by this project).
if (!chrome.alarms) {
  chrome.alarms = {
    create: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn(),
    },
  };
}
