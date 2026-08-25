<script lang="ts">
	import '$lib/learn/lesson.css';

	let { children } = $props();
</script>

<div class="learn">{@render children()}</div>
