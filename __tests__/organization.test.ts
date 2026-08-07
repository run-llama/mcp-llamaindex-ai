import {
  clearOrganizationCache,
  resolveOrganizationId,
} from '../lib/business/organization';
import { llamaCloudClient } from '../lib/business/client';

jest.mock('../lib/business/client', () => ({
  llamaCloudClient: jest.fn(),
}));

const mockedClient = llamaCloudClient as jest.MockedFunction<
  typeof llamaCloudClient
>;

type FakeProject = {
  id: string;
  organization_id: string;
  is_default?: boolean;
};

const PROJECTS: FakeProject[] = [
  { id: 'proj_a', organization_id: 'org_a' },
  { id: 'proj_b', organization_id: 'org_b', is_default: true },
];

/** Stub the two calls the resolver can make, so each test can assert which ran. */
function stubClient({
  projects = PROJECTS,
  getError,
}: {
  projects?: FakeProject[];
  getError?: Error;
} = {}) {
  const get = jest.fn((id: string) => {
    if (getError) {
      return Promise.reject(getError);
    }
    const project = projects.find((p) => p.id === id);
    return project
      ? Promise.resolve(project)
      : Promise.reject(new Error('404 project not found'));
  });
  const list = jest.fn(() => Promise.resolve(projects));
  mockedClient.mockReturnValue({
    projects: { get, list },
  } as unknown as ReturnType<typeof llamaCloudClient>);
  return { get, list };
}

describe('resolveOrganizationId', () => {
  beforeEach(() => {
    clearOrganizationCache();
    jest.clearAllMocks();
  });

  it('fetches a named project directly instead of searching a listing', async () => {
    const { get, list } = stubClient();

    await expect(
      resolveOrganizationId({
        authToken: 'token',
        userId: 'user_1',
        projectId: 'proj_a',
      })
    ).resolves.toBe('org_a');

    expect(get).toHaveBeenCalledWith('proj_a', undefined, expect.anything());
    // The listing is unbounded, so a named project must never depend on it.
    expect(list).not.toHaveBeenCalled();
  });

  it('uses the default project when none is named', async () => {
    const { get, list } = stubClient();

    await expect(
      resolveOrganizationId({ authToken: 'token', userId: 'user_1' })
    ).resolves.toBe('org_b');

    expect(list).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('returns undefined rather than guessing when no project is marked default', async () => {
    // Attributing to an arbitrary project would name the wrong organization,
    // which is worse than recording nothing.
    stubClient({ projects: [{ id: 'proj_a', organization_id: 'org_a' }] });

    await expect(
      resolveOrganizationId({ authToken: 'token', userId: 'user_1' })
    ).resolves.toBeUndefined();
  });

  it('returns undefined for a project the caller cannot see', async () => {
    stubClient();

    await expect(
      resolveOrganizationId({
        authToken: 'token',
        userId: 'user_1',
        projectId: 'proj_missing',
      })
    ).resolves.toBeUndefined();
  });

  it('caches per project, since a user can span organizations', async () => {
    const { get } = stubClient();

    await resolveOrganizationId({
      authToken: 'token',
      userId: 'user_1',
      projectId: 'proj_a',
    });
    await resolveOrganizationId({
      authToken: 'token',
      userId: 'user_1',
      projectId: 'proj_a',
    });
    expect(get).toHaveBeenCalledTimes(1);

    await expect(
      resolveOrganizationId({
        authToken: 'token',
        userId: 'user_1',
        projectId: 'proj_b',
      })
    ).resolves.toBe('org_b');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('degrades to undefined when the API fails, without caching the miss', async () => {
    stubClient({ getError: new Error('api down') });
    await expect(
      resolveOrganizationId({
        authToken: 'token',
        userId: 'user_1',
        projectId: 'proj_a',
      })
    ).resolves.toBeUndefined();

    // A transient failure must not blind attribution until the TTL expires.
    stubClient();
    await expect(
      resolveOrganizationId({
        authToken: 'token',
        userId: 'user_1',
        projectId: 'proj_a',
      })
    ).resolves.toBe('org_a');
  });
});
