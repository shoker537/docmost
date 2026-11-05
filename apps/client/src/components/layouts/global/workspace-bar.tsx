import { Group } from "@mantine/core";
import TopMenu from "./top-menu";
import { SearchMobileControl } from "@/features/search/components/search-control";
import { searchSpotlight } from "@/features/search/constants";
import classes from "./app-shell.module.css";

export default function WorkspaceBar() {
  return (
    <Group className={classes.workspaceBar} wrap="nowrap" gap={6}>
      <TopMenu compact />
      <SearchMobileControl onSearch={searchSpotlight.open} />
    </Group>
  );
}
