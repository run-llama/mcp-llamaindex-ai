import UploadForm from '../../components/UploadForm';

// @ts-expect-error params is implictly any
export default async function UploadPage({ params }) {
  const { token } = await params;
  return <UploadForm token={token} />;
}
