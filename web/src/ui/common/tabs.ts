/** The tab on screen; App keeps it on <body>. Each tab's window key handlers ignore keys while it is hidden. */
export type TabId = 'pro' | 'auto' | 'browser';

export const isTabShown = (tab: TabId) => document.body.dataset.tab === tab;
