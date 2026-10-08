// The touch scenarios in Chrome for Android, with touch input sent to Chrome through the DevTools protocol.
import { androidChromeTest } from '../lib/android';
import { touchScenarios } from '../scenarios/touch';

touchScenarios(androidChromeTest);
