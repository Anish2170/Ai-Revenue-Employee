type IconName =
  | 'ads_click'
  | 'chat_bubble'
  | 'check'
  | 'insights'
  | 'language'
  | 'lock'
  | 'person_add'
  | 'psychology'
  | 'radar'
  | 'route'
  | 'search_check'
  | 'settings'
  | 'support_agent'
  | 'timer'
  | 'home'
  | 'activity'
  | 'database'
  | 'sliders'
  | 'chevron_down'
  | 'arrow_right'
  | 'close'
  | 'refresh'
  | 'menu';

const paths: Record<IconName, string> = {
  ads_click: 'M13 3 4 14h7l-2 7 11-12h-7l2-6z',
  chat_bubble: 'M4 5h16v11H7l-3 3V5z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  insights: 'M4 18h16v2H4v-2zm1-2 4-5 4 3 5-7 2 1.5-7 9-4-3-4 5-4-3z',
  language: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3.1a15.8 15.8 0 0 0-1.2-5 8.03 8.03 0 0 1 4.3 5zM12 4.1c.9 1.3 1.6 3.7 1.8 6.9h-3.6c.2-3.2.9-5.6 1.8-6.9zM4.3 13h3.9c.1 1.6.4 3.1.8 4.4A8.05 8.05 0 0 1 4.3 13zm3.9-2H4.3A8.05 8.05 0 0 1 9 6c-.4 1.3-.7 2.8-.8 5zm3.8 8.9c-.9-1.3-1.6-3.7-1.8-6.9h3.6c-.2 3.2-.9 5.6-1.8 6.9zm3-2.5c.4-1.3.7-2.8.8-4.4h3.9a8.05 8.05 0 0 1-4.7 4.4z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2h1zm2 0h6V8a3 3 0 0 0-6 0v2z',
  person_add: 'M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zM3 20c.5-3.3 4.1-6 8.5-6 1.1 0 2.1.2 3 .5A6 6 0 0 0 13 20H3zm15-5v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2z',
  psychology: 'M13 3a7 7 0 0 1 7 7c0 2.1-.9 3.9-2.3 5.2V21h-7v-3H8a4 4 0 0 1-4-4v-2H2l2.3-3.1A7 7 0 0 1 13 3zm-1 4v2h2V7h-2zm-3 3v2h2v-2H9zm6 0v2h2v-2h-2zm-3 3v2h2v-2h-2z',
  radar: 'M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2zm0 4a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4V6zm0 4a2 2 0 1 0 2 2h-2v-2zm1-8v10l7-7-1.4-1.4L15 7.2V2h-2z',
  route: 'M6 4a3 3 0 0 0-1 5.8V14a4 4 0 0 0 4 4h6.2a3 3 0 1 0 0-2H9a2 2 0 0 1-2-2V9.8A3 3 0 0 0 6 4zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm12 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  search_check: 'M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm-1 5.2 4-4 1.4 1.4-5.4 5.4-2.9-2.9L8 9.7l1.5 1.5z',
  settings: 'M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14 2h-4l-.4 3a7.8 7.8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5A9.6 9.6 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5l.4 3h4l.4-3a7.8 7.8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z',
  support_agent: 'M12 3a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h2v-7H6v-1a6 6 0 1 1 12 0v1h-3v7h1a4 4 0 0 1-4 3h-2v-2h2a2 2 0 0 0 2-2h3a3 3 0 0 0 3-3v-5a8 8 0 0 0-8-8z',
  timer: 'M9 1h6v2H9V1zm2 12V7h2v7l5 3-1 1.7-6-3.7V13zm1-9a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  home: 'M3 11.2 12 3l9 8.2v9.3h-6v-6H9v6H3v-9.3z',
  activity: 'M3 12h4l2.1-5 4 10L16 12h5v2h-6.3l-1.4 3.5-4.2-10L8.3 14H3v-2z',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm-8 7.2c1.6 1.2 4.5 1.8 8 1.8s6.4-.6 8-1.8V14c0 1.7-3.6 3-8 3s-8-1.3-8-3v-3.8zm0 7c1.6 1.2 4.5 1.8 8 1.8s6.4-.6 8-1.8V18c0 1.7-3.6 3-8 3s-8-1.3-8-3v-.8z',
  sliders: 'M4 7h10v2H4V7zm12-2h2v6h-2V5zM4 15h4v2H4v-2zm6-2h2v6h-2v-6zm4 2h6v2h-6v-2z',
  chevron_down: 'm7 10 5 5 5-5z',
  arrow_right: 'M5 11h10.2l-3.6-3.6L13 6l6 6-6 6-1.4-1.4 3.6-3.6H5v-2z',
  close: 'm6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5z',
  refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.7-4.3L13 11h7V4l-2.3 2.3z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      height="1em"
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={paths[name]} />
    </svg>
  );
}



