-- Built-in creative guilds. No memberships, appointments, books or repositories are fabricated.
INSERT INTO positioning_guild_catalog(guild_key,profession_key,name,purpose,first_step,module_key,catalog_version) VALUES
('guild_games','games','小遊戲公會','製作與體驗小遊戲，分享遊玩成果。','選一個遊戲開始體驗。','guilds',4),
('guild_ar','ar','AR 互動公會','製作與體驗圖案辨識和 AR 互動。','建立一張互動圖案。','ar',4);
INSERT INTO positioning_track_catalog(track_key,name,description,guild_key,role_key,first_result,estimated_minutes,catalog_version) VALUES
('game_creator','小遊戲創作者','體驗遊戲並製作互動作品。','guild_games','creator','一份遊戲成果或體驗回饋',15,4),
('ar_creator','AR 互動創作者','製作圖案辨識與互動體驗。','guild_ar','creator','一張可體驗的互動圖案',20,4);
-- Category approval is a human decision. Pending rows remain joinable like existing unclassified guilds.
INSERT INTO guild_catalog_categories(guild_key,category,category_review,catalog_revision,capability_tags,active) VALUES
('guild_games',NULL,'pending',nextval('guild_catalog_revision'),'{}',true),
('guild_ar',NULL,'pending',nextval('guild_catalog_revision'),'{}',true);
