import { getAuthenticatedUser } from '../../lib/with-authkit';
import UploadForm from '../components/UploadForm';

export default async function UploadPage() {
  const user = await getAuthenticatedUser();
  return <UploadForm user={user} />;
}
