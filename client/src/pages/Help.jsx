// Admin Help / onboarding page (routes: /help, /help/:slug).
import { useParams } from 'react-router-dom';
import HelpGuide from '../components/HelpGuide';

export default function Help() {
  const { slug } = useParams();
  return <HelpGuide variant="admin" basePath="/help" slug={slug} />;
}
