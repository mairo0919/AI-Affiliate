<?php
/**
 * Title: 関連記事セクション
 * Slug: otonaselect/related-posts
 * Categories: otonaselect
 * Description: 記事詳細向け。出演者→シリーズ→カテゴリの順で関連寄せ（件数を無理に埋めない）。
 */
?>
<!-- wp:group {"style":{"spacing":{"blockGap":"var:preset|spacing|40"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
	<!-- wp:heading {"level":2,"fontSize":"x-large"} -->
	<h2 class="wp-block-heading has-x-large-font-size">関連記事</h2>
	<!-- /wp:heading -->

	<!-- wp:query {"queryId":31,"query":{"perPage":3,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":false},"className":"otonaselect-related","layout":{"type":"constrained"}} -->
	<div class="wp-block-query otonaselect-related">
		<!-- wp:post-template -->
			<!-- wp:post-title {"isLink":true,"fontSize":"large"} /-->
		<!-- /wp:post-template -->

		<!-- wp:query-no-results -->
			<!-- wp:paragraph {"textColor":"muted","fontSize":"small"} -->
			<p class="has-muted-color has-text-color has-small-font-size">いま表示できる関連記事はありません。</p>
			<!-- /wp:paragraph -->
		<!-- /wp:query-no-results -->
	</div>
	<!-- /wp:query -->
</div>
<!-- /wp:group -->
