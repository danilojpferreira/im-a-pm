import { useParams } from 'react-router-dom';

export function ConfirmationPage() {
  const { id } = useParams();
  return <p>Thanks! Order {id} is confirmed. We'll email you the tracking links.</p>;
}
