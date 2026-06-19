// Parent portal Help / onboarding page (routes: /portal/help, /portal/help/:slug).
import { useParams } from 'react-router-dom';
import HelpGuide from '../../components/HelpGuide';

export default function PortalHelp() {
  const { slug } = useParams();
  return <HelpGuide variant="parent" basePath="/portal/help" slug={slug} />;
}
