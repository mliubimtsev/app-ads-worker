export const StageEntriesSQL = {
  clearProcessed: /* sql */ `
    DELETE FROM stage_app_ads WHERE run_id = $1
    `,
};
