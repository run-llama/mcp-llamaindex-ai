import { PostHog } from 'posthog-node';
import {
  TOOL_CALL_EVENT,
  captureToolUsage,
  resetPostHogClient,
} from '../lib/observability/posthog';
import { UNKNOWN, type ToolUsageEvent } from '../lib/observability/usage-event';

jest.mock('posthog-node', () => ({
  PostHog: jest.fn(),
}));

const MockedPostHog = PostHog as unknown as jest.Mock;

const captureImmediate = jest.fn(
  (payload: Record<string, unknown>): Promise<void> => {
    void payload;
    return Promise.resolve();
  }
);

/** The single captured payload, asserted to exist so callers can index it. */
function firstCapture(): Record<string, unknown> {
  expect(captureImmediate).toHaveBeenCalledTimes(1);
  return captureImmediate.mock.calls[0]![0];
}

const EVENT: ToolUsageEvent = {
  tool: 'parseFile',
  surface: 'parse',
  scoped: false,
  region: 'na',
  userId: 'user_01ABC',
  projectId: 'proj_9',
  organizationId: 'org_7',
  outcome: 'success',
  durationMs: 120,
};

describe('captureToolUsage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POSTHOG_HOST;
    process.env.POSTHOG_API_KEY = 'phc_test';
    process.env.VERCEL_ENV = 'production';
    jest.clearAllMocks();
    resetPostHogClient();
    MockedPostHog.mockImplementation(() => ({ captureImmediate }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('sends the payload the platform’s own events are shaped like', async () => {
    await captureToolUsage(EVENT);

    expect(firstCapture()).toEqual({
      // The WorkOS user id: what PostHog joins MCP usage to console and API
      // activity on.
      distinctId: 'user_01ABC',
      event: TOOL_CALL_EVENT,
      groups: { organization: 'org_7' },
      properties: {
        tool: 'parseFile',
        surface: 'parse',
        scoped: false,
        region: 'na',
        user_id: 'user_01ABC',
        project_id: 'proj_9',
        organization_id: 'org_7',
        outcome: 'success',
        duration_ms: 120,
        environment: 'production',
      },
    });
  });

  it('omits the organization rather than sending a placeholder group', async () => {
    await captureToolUsage({ ...EVENT, organizationId: UNKNOWN });

    const call = firstCapture() as {
      groups?: unknown;
      properties: Record<string, unknown>;
    };
    expect(call.groups).toBeUndefined();
    expect(call.properties).not.toHaveProperty('organization_id');
  });

  it('drops unauthenticated calls, which have no person to attribute', async () => {
    await captureToolUsage({ ...EVENT, userId: UNKNOWN });

    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('stays off when no key is configured', async () => {
    delete process.env.POSTHOG_API_KEY;
    resetPostHogClient();

    await captureToolUsage(EVENT);

    expect(MockedPostHog).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'https://us.i.posthog.com'],
    ['http://localhost:8010', 'http://localhost:8010'],
  ])('resolves POSTHOG_HOST=%p to %p', async (configured, expected) => {
    if (configured) {
      process.env.POSTHOG_HOST = configured;
    }
    resetPostHogClient();

    await captureToolUsage(EVENT);

    expect(MockedPostHog).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ host: expected })
    );
  });

  it('swallows a reporting failure so the tool call still succeeds', async () => {
    captureImmediate.mockRejectedValueOnce(new Error('posthog down'));

    await expect(captureToolUsage(EVENT)).resolves.toBeUndefined();
  });
});
