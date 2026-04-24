import UploadForm from '../../components/UploadForm';

// @ts-expect-error params is implictly any
export default async function UploadPage({ params, searchParams }) {
  const { token } = await params;
  const { project_id } = await searchParams;
  return <UploadForm token={token} projectId={project_id} />;
}
