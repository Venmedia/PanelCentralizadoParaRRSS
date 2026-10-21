const {
  DEFAULT_GREETING_MENU,
  DEFAULT_OUT_OF_HOURS_MESSAGE
} = require('../config/constants');

function getAutoReplyMessage(config) {
  const cfg = config || {};
  const sched = cfg.schedule || {};
  const greetingMenu = cfg.greeting || DEFAULT_GREETING_MENU;
  const outOfHoursMsg = sched.welcomeMessage || DEFAULT_OUT_OF_HOURS_MESSAGE;
  const source = sched.autoReplySource || 'greeting_menu';

  if (source === 'out_of_hours') return outOfHoursMsg;
  if (source === 'both') return `${outOfHoursMsg}\n\n${greetingMenu}`;
  return greetingMenu;
}

function evaluateSchedule(scheduleConfig, fullConfig) {
  const sched = scheduleConfig || {};
  const mode = sched.mode || 'outside_work_hours';
  const workStart = sched.workStart || '08:00';
  const workEnd = sched.workEnd || '17:00';
  const welcomeMessage = getAutoReplyMessage(fullConfig || { schedule: sched });

  // SIEMPRE usar hora de Venezuela (America/Caracas = UTC-4) garantizada con Intl
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = dtf.formatToParts(now);
  const vzHours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const vzMinutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const currentMinutes = vzHours * 60 + vzMinutes;

  const [startH, startM] = workStart.split(':').map(Number);
  const [endH, endM] = workEnd.split(':').map(Number);
  const startMinutes = (!isNaN(startH) ? startH : 8) * 60 + (!isNaN(startM) ? startM : 0);
  const endMinutes = (!isNaN(endH) ? endH : 17) * 60 + (!isNaN(endM) ? endM : 0);

  let isInsideWorkHours = false;
  if (startMinutes <= endMinutes) {
    isInsideWorkHours = currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    isInsideWorkHours = currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  let shouldAutoReply = false;
  if (mode === 'outside_work_hours') {
    shouldAutoReply = !isInsideWorkHours;
  } else if (mode === 'inside_work_hours') {
    shouldAutoReply = isInsideWorkHours;
  } else if (mode === 'always') {
    shouldAutoReply = true;
  } else if (mode === 'disabled') {
    shouldAutoReply = false;
  }

  return {
    mode,
    workStart,
    workEnd,
    welcomeMessage,
    isInsideWorkHours,
    shouldAutoReply,
    serverTime: `${String(vzHours).padStart(2, '0')}:${String(vzMinutes).padStart(2, '0')} (VE)`
  };
}

module.exports = {
  getAutoReplyMessage,
  evaluateSchedule
};
