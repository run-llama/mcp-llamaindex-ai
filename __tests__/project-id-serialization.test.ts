jest.mock('@llamaindex/liteparse-wasm', () => ({}), { virtual: true });

const retrieve = jest.fn().mockResolvedValue({ results: [] });

jest.mock('../lib/business/client', () => ({
  llamaCloudClient: () => ({ beta: { retrieval: { retrieve } } }),
}));

import { retrieveFromIndex } from '../lib/business/llamaparse';

// `project_id` is a query param. A null reaches the wire as `project_id=`,
// which the API rejects with a 422 instead of resolving the default project —
// so "omitted" has to mean absent, not null and not empty string.
describe('project_id serialization', () => {
  beforeEach(() => retrieve.mockClear());

  it('omits project_id entirely when the caller does not supply one', async () => {
    await retrieveFromIndex({ authToken: 't', indexId: 'idx', query: 'q' });

    const sent = retrieve.mock.calls[0][0];
    expect(sent.project_id).toBeUndefined();
    expect(sent.project_id).not.toBeNull();
    expect(sent.project_id).not.toBe('');
  });

  it('omits project_id when explicitly passed null', async () => {
    await retrieveFromIndex({
      authToken: 't',
      indexId: 'idx',
      query: 'q',
      projectId: null,
    });
    expect(retrieve.mock.calls[0][0].project_id).toBeUndefined();
  });

  it('forwards a project_id when the caller supplies one', async () => {
    await retrieveFromIndex({
      authToken: 't',
      indexId: 'idx',
      query: 'q',
      projectId: 'ea14e2b9-0000-0000-0000-000000000000',
    });
    expect(retrieve.mock.calls[0][0].project_id).toBe(
      'ea14e2b9-0000-0000-0000-000000000000'
    );
  });

  // The API enables reranking by default; sending `{enabled: false}` silently
  // overrode that and degraded every unparameterised retrieval.
  it('leaves rerank unset so the API default applies', async () => {
    await retrieveFromIndex({ authToken: 't', indexId: 'idx', query: 'q' });
    expect(retrieve.mock.calls[0][0].rerank).toBeUndefined();
  });

  it('enables reranking with top_n when the caller asks for it', async () => {
    await retrieveFromIndex({
      authToken: 't',
      indexId: 'idx',
      query: 'q',
      rerankTopN: 5,
    });
    expect(retrieve.mock.calls[0][0].rerank).toEqual({
      enabled: true,
      top_n: 5,
    });
  });
});
