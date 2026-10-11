import { Page } from "../app/Shell";
import { Button, Empty } from "../ui";

export default function NotFound() {
  return (
    <Page title="This gate doesn't exist">
      <Empty title="Nothing departs from here" action={<Button variant="primary" to="/">Back to the dashboard</Button>}>
        Check the address, or head back to the departures board.
      </Empty>
    </Page>
  );
}
