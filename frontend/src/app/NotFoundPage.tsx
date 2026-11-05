import { Link } from 'react-router-dom';
import { Empty, PageHeader } from '@/components';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Empty>
        This page does not exist. <Link to="/">Go to the dashboard</Link>.
      </Empty>
    </>
  );
}
