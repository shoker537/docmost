import { Container, Text, Title } from "@mantine/core";
import HomeTabs from "@/features/home/components/home-tabs";
import HomeAiPrompt from "@/features/home/components/home-ai-prompt";
import SpaceCarousel from "@/features/space/components/space-carousel.tsx";
import { useTranslation } from "react-i18next";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { useAtomValue } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import classes from "./home.module.css";

export default function Home() {
  const { t } = useTranslation();
  const workspace = useAtomValue(workspaceAtom);

  return (
    <>
      <DocumentTitle title={t("Home")} />
      <Container size={960} className={classes.container}>
        <header className={classes.heading}>
          <Text size="sm" c="dimmed" mb={8}>
            {t("Home")}
          </Text>
          <Title order={1} className={classes.title}>
            {t("Welcome to {{name}}", { name: workspace?.name ?? "Docmost" })}
          </Title>
        </header>
        <HomeAiPrompt />
        <section className={classes.pages}>
          <HomeTabs />
        </section>
        <section className={classes.spaces}>
          <SpaceCarousel />
        </section>
      </Container>
    </>
  );
}
