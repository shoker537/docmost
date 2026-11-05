import { Text, Card, Group, Button, Skeleton, Title } from "@mantine/core";
import {
  prefetchSpace,
  useGetSpacesQuery,
} from "@/features/space/queries/space-query.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import { Link } from "react-router-dom";
import classes from "./space-carousel.module.css";
import { formatMemberCount } from "@/lib";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import CardCarousel from "@/components/ui/card-carousel";

function SpaceCardSkeleton() {
  return (
    <Card p="xs" radius="md" withBorder className={classes.card}>
      <Skeleton circle height={20} width={20} />
      <Skeleton height={14} mt="xs" width="70%" radius="xl" />
      <Skeleton height={10} mt="md" width="40%" radius="xl" />
    </Card>
  );
}

export default function SpaceCarousel() {
  const { t } = useTranslation();
  const { data, isPending } = useGetSpacesQuery({ limit: 20 });

  if (isPending) {
    return (
      <>
        <Group justify="space-between" align="center" mb="md">
          <Title order={2} size="h6" fw={500}>
            {t("Spaces you belong to")}
          </Title>
        </Group>
        <CardCarousel ariaLabel={t("Spaces you belong to")}>
          {Array.from({ length: 4 }, (_, i) => (
            <SpaceCardSkeleton key={i} />
          ))}
        </CardCarousel>
      </>
    );
  }

  const cards = data?.items.map((space) => (
    <Card
      key={space.id}
      p="xs"
      radius="md"
      component={Link}
      to={getSpaceUrl(space.slug)}
      onMouseEnter={() => prefetchSpace(space.slug, space.id)}
      className={classes.card}
      withBorder
    >
      <Group wrap="nowrap" gap={8}>
        <CustomAvatar
          name={space.name}
          avatarUrl={space.logo}
          type={AvatarIconType.SPACE_ICON}
          color="gray"
          variant="light"
          size={20}
        />

        <Text fz="xs" fw={600} className={classes.title}>
          {space.name}
        </Text>
      </Group>

      <Text c="dimmed" size="xs" fw={400} mt="md">
        {formatMemberCount(space.memberCount, t)}
      </Text>
    </Card>
  ));

  return (
    <>
      <Group
        justify="space-between"
        align="center"
        mb="xs"
        className={classes.sectionHeader}
      >
        <Title order={2} size="xs" fw={600}>
          {t("Spaces you belong to")}
        </Title>
        {data?.items && data.items.length > 1 && (
          <Button
            component={Link}
            to="/spaces"
            variant="subtle"
            color="gray"
            size="compact-xs"
          >
            {t("View all spaces")}
          </Button>
        )}
      </Group>

      <CardCarousel ariaLabel={t("Spaces you belong to")}>{cards}</CardCarousel>
    </>
  );
}
