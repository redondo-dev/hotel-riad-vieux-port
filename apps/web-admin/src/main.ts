import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // eslint-disable-next-line no-console -- last-resort report when the application cannot start
  console.error(error);
});
